import createCacheMethods from '../createCacheMethods'

const MOCK_ENTRIES = [
  {
    _id: 'id1',
    slug: 'slug1',
    title: 'Breaking Bad',
  },
  {
    _id: 'id3',
    slug: 'slug3',
    title: 'Prison Break',
  },
]

const createMockModel = name => ({
  modelName: name,
  find: async query => {
    const keys = (query._id || query.slug).$in
    const isFindBySlug = !!query.slug

    const response = keys.map(key => {
      if (key === 'id2') {
        return null
      }

      const payload = MOCK_ENTRIES.find(
        entry => (isFindBySlug ? entry.slug : entry._id) === key,
      )

      return {
        ...payload,
        toObject() {
          return {
            ...payload,
          }
        },
      }
    })

    return response
  },
})

const commonParams = {
  enable: true,
  onCacheMiss: () => {},
  onDataMiss: () => {},
  additionalCacheKeys: [],
  redis: {},
}

test('withCachePrefix', async () => {
  const { withCachePrefix } = createCacheMethods({
    ...commonParams,
    model: createMockModel('Entry'),
  })

  expect(withCachePrefix('id1')).toBe('entry:id1')
})

test('onBatchCacheMiss', async () => {
  const onCacheMiss = jest.fn()

  const { onBatchCacheMiss } = createCacheMethods({
    ...commonParams,
    model: createMockModel('Entry'),
    onCacheMiss,
  })

  await onBatchCacheMiss(['id1', 'id2'])
  expect(onCacheMiss).toHaveBeenCalledTimes(2)
  expect(onCacheMiss).toHaveBeenCalledWith('Entry', 'id1')
  expect(onCacheMiss).toHaveBeenCalledWith('Entry', 'id2')
})

test('onBatchDataMiss', async () => {
  const onDataMiss = jest.fn()

  const { onBatchDataMiss } = createCacheMethods({
    ...commonParams,
    model: createMockModel('Entry'),
    onDataMiss,
  })

  await onBatchDataMiss(['id1', 'id2'])
  expect(onDataMiss).toHaveBeenCalledTimes(2)
  expect(onDataMiss).toHaveBeenCalledWith('Entry', 'id1')
  expect(onDataMiss).toHaveBeenCalledWith('Entry', 'id2')
})

describe('resolves from database', () => {
  test('getManyBy', async () => {
    const onDataMiss = jest.fn()
    const { getManyBy } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      onDataMiss,
    })

    expect(await getManyBy('_id', ['id1', 'id2', 'id3'])).toMatchObject([
      { _id: 'id1', title: 'Breaking Bad' },
      null,
      { _id: 'id3', title: 'Prison Break' },
    ])

    expect(onDataMiss.mock.calls.length).toBe(1)
    expect(onDataMiss.mock.calls[0][0]).toBe('Entry')
    expect(onDataMiss.mock.calls[0][1]).toBe('id2')
  })

  test('getBy', async () => {
    const onDataMiss = jest.fn()
    const { getBy } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      onDataMiss,
    })

    expect(await getBy('_id', 'id1')).toMatchObject({
      _id: 'id1',
      title: 'Breaking Bad',
    })
    expect(await getBy('_id', 'id2')).toBeNull()

    expect(onDataMiss.mock.calls.length).toBe(1)

    const [arg1, arg2] = onDataMiss.mock.calls[0]
    expect(arg1).toBe('Entry')
    expect(arg2).toBe('id2')
  })
})

describe('set cache', () => {
  test('cacheSetMany', async () => {
    const execAsync = jest.fn()
    const multi = jest.fn(() => ({
      execAsync,
    }))

    const { cacheSetMany } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      redis: {
        multi,
      },
    })

    await cacheSetMany([
      ['id1', { title: 'Rush' }],
      ['id2', null],
      ['id3', { title: '50 First Dates' }],
    ])

    expect(multi).toBeCalledTimes(1)
    expect(multi).toHaveBeenCalledWith([
      ['set', 'entry:id1', '{"title":"Rush"}'],
      ['set', 'entry:id3', '{"title":"50 First Dates"}'],
    ])
    expect(execAsync.mock.calls.length).toBe(1)
  })

  test('cacheSet', async () => {
    const execAsync = jest.fn()
    const multi = jest.fn(() => ({
      execAsync,
    }))

    const { cacheSet } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      redis: {
        multi,
      },
    })

    await cacheSet('id1', { title: 'Passengers' })
    expect(multi).toBeCalledTimes(1)
    expect(multi).toHaveBeenCalledWith([
      ['set', 'entry:id1', '{"title":"Passengers"}'],
    ])
    expect(execAsync.mock.calls.length).toBe(1)
  })
})

describe('resolve from cache', () => {
  describe('cacheGetManyBy', () => {
    test('disable cache', async () => {
      const execAsync = jest.fn()
      const multi = jest.fn(() => ({
        execAsync,
      }))
      const onCacheMiss = jest.fn()
      const onDataMiss = jest.fn()

      const { cacheGetManyBy } = createCacheMethods({
        ...commonParams,
        enable: false,
        model: createMockModel('Entry'),
        redis: {
          multi,
        },
        onCacheMiss,
        onDataMiss,
      })

      expect(await cacheGetManyBy('_id', ['id1'])).toMatchObject([
        {
          _id: 'id1',
          title: 'Breaking Bad',
        },
      ])
      expect(onCacheMiss).toHaveBeenCalledTimes(0)
      expect(onDataMiss).toHaveBeenCalledTimes(0)

      // database does not have the value with key "id2"
      expect(await cacheGetManyBy('_id', ['id2'])).toMatchObject([null])
      expect(onCacheMiss).toHaveBeenCalledTimes(0)
      expect(onDataMiss).toHaveBeenCalledTimes(1)
      expect(multi).toBeCalledTimes(0)
    })

    test('enable cache', async () => {
      const execAsync = jest.fn(() => [null])
      const execAsyncCacheHit = jest.fn(() => [
        JSON.stringify({
          title: 'Breaking Bad',
        }),
      ])
      const multi = jest.fn(([[operation, key]]) => {
        if (key === 'entry:id1') {
          return {
            execAsync: execAsyncCacheHit,
          }
        }

        return {
          execAsync,
        }
      })

      const onCacheMiss = jest.fn()
      const onDataMiss = jest.fn()

      const { cacheGetManyBy } = createCacheMethods({
        ...commonParams,
        model: createMockModel('Entry'),
        redis: {
          multi,
        },
        onCacheMiss,
        onDataMiss,
      })

      // Case 1 - Cache hit
      expect(await cacheGetManyBy('_id', ['id1'])).toMatchObject([
        {
          title: 'Breaking Bad',
        },
      ])
      expect(multi).toBeCalledTimes(1)

      // Case 2 - Cache miss and data miss
      expect(await cacheGetManyBy('_id', ['id2'])).toMatchObject([null])
      expect(onCacheMiss).toBeCalledTimes(1)
      expect(onCacheMiss).toHaveBeenCalledWith('Entry', 'id2')
      expect(onDataMiss).toBeCalledTimes(1)
      expect(onDataMiss).toHaveBeenCalledWith('Entry', 'id2')
      expect(multi).toBeCalledTimes(2)

      // Case 3 - Cache miss and data hit
      expect(await cacheGetManyBy('_id', ['id3'])).toMatchObject([
        {
          title: 'Prison Break',
        },
      ])
      expect(onCacheMiss).toBeCalledTimes(2)
      expect(onCacheMiss).toHaveBeenCalledWith('Entry', 'id3')
      expect(onDataMiss).toBeCalledTimes(1)
      expect(multi).toBeCalledWith([
        [
          'set',
          'entry:id3',
          JSON.stringify({
            _id: 'id3',
            slug: 'slug3',
            title: 'Prison Break',
          }),
        ],
      ])
    })

    test('additionalCacheKeys', async () => {
      const execAsync = jest.fn(() => [null])
      const execAsyncCacheHit = jest.fn(() => [
        JSON.stringify({
          title: 'Breaking Bad',
        }),
      ])
      const multi = jest.fn(([[operation, key]]) => {
        if (key === 'entry:id1') {
          return {
            execAsync: execAsyncCacheHit,
          }
        }

        return {
          execAsync,
        }
      })

      const onCacheMiss = jest.fn()
      const onDataMiss = jest.fn()

      const { cacheGetManyBy } = createCacheMethods({
        ...commonParams,
        model: createMockModel('Entry'),
        redis: {
          multi,
        },
        onCacheMiss,
        onDataMiss,
        additionalCacheKeys: ['slug'],
      })

      // Case 1 - Cache hit
      expect(await cacheGetManyBy('_id', ['id1'])).toMatchObject([
        {
          title: 'Breaking Bad',
        },
      ])

      expect(multi).toHaveBeenCalledTimes(1)
      expect(multi).toHaveBeenNthCalledWith(1, [['get', 'entry:id1']])

      // Case 2 - Cache miss and fill cache with additional keys
      expect(await cacheGetManyBy('_id', ['id3'])).toMatchObject([
        {
          title: 'Prison Break',
        },
      ])

      expect(multi).toHaveBeenCalledTimes(3)
      expect(multi).toHaveBeenNthCalledWith(2, [['get', 'entry:id3']])
      const expectedPayload = JSON.stringify({
        _id: 'id3',
        slug: 'slug3',
        title: 'Prison Break',
      })
      expect(multi).toHaveBeenNthCalledWith(3, [
        ['set', 'entry:id3', expectedPayload],
        ['set', 'entry:slug3', expectedPayload],
      ])
    })
  })

  test('cacheGetBy', async () => {
    const execAsync = jest.fn(() => [null])
    const execAsyncCacheHit = jest.fn(() => [
      JSON.stringify({
        title: 'Terrace House',
      }),
    ])
    const multi = jest.fn(([[operation, key]]) => {
      if (key === 'entry:id1') {
        return {
          execAsync: execAsyncCacheHit,
        }
      }

      return {
        execAsync,
      }
    })

    const onCacheMiss = jest.fn()
    const onDataMiss = jest.fn()

    const { cacheGetBy } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      redis: {
        multi,
      },
      onCacheMiss,
      onDataMiss,
      additionalCacheKeys: ['slug'],
    })

    // Case 1 - Cache hit
    expect(await cacheGetBy('slug', 'id1')).toMatchObject({
      title: 'Terrace House',
    })
    expect(multi).toBeCalledTimes(1)

    // Case 2 - Cache miss and data miss
    expect(await cacheGetBy('slug', 'id2')).toBeNull()
    expect(onCacheMiss).toBeCalledTimes(1)
    expect(onCacheMiss).toHaveBeenCalledWith('Entry', 'id2')
    expect(onDataMiss).toBeCalledTimes(1)
    expect(onDataMiss).toHaveBeenCalledWith('Entry', 'id2')
    expect(multi).toBeCalledTimes(2)

    // Case 3 - Cache miss and data hit
    expect(await cacheGetBy('slug', 'slug3')).toMatchObject({
      title: 'Prison Break',
    })
    expect(onCacheMiss).toBeCalledTimes(2)
    expect(onCacheMiss).toHaveBeenCalledWith('Entry', 'slug3')
    expect(onDataMiss).toBeCalledTimes(1)
    expect(multi).toHaveBeenNthCalledWith(3, [['get', 'entry:slug3']])
    const expectedCacheBody = JSON.stringify({
      _id: 'id3',
      slug: 'slug3',
      title: 'Prison Break',
    })
    expect(multi).toHaveBeenNthCalledWith(4, [
      ['set', 'entry:slug3', expectedCacheBody],
    ])
  })

  test('cacheGet', async () => {
    const execAsync = jest.fn(() => [null])
    const execAsyncCacheHit = jest.fn(() => [
      JSON.stringify({
        title: 'Inception',
      }),
    ])
    const multi = jest.fn(([[operation, key]]) => {
      if (key === 'entry:id1') {
        return {
          execAsync: execAsyncCacheHit,
        }
      }

      return {
        execAsync,
      }
    })

    const onCacheMiss = jest.fn()
    const onDataMiss = jest.fn()

    const { cacheGet } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      redis: {
        multi,
      },
      onCacheMiss,
      onDataMiss,
    })

    // Case 1 - Cache hit
    expect(await cacheGet('id1')).toMatchObject({
      title: 'Inception',
    })
    expect(multi).toBeCalledTimes(1)

    // Case 2 - Cache miss and data miss
    expect(await cacheGet('id2')).toBeNull()
    expect(onCacheMiss).toBeCalledTimes(1)
    expect(onCacheMiss).toHaveBeenCalledWith('Entry', 'id2')
    expect(onDataMiss).toBeCalledTimes(1)
    expect(onDataMiss).toHaveBeenCalledWith('Entry', 'id2')
    expect(multi).toBeCalledTimes(2)
    expect(multi).toHaveBeenNthCalledWith(2, [['get', 'entry:id2']])

    // Case 3 - Cache miss and data hit
    expect(await cacheGet('id3')).toMatchObject({
      title: 'Prison Break',
    })
    expect(onCacheMiss).toBeCalledTimes(2)
    expect(onCacheMiss).toHaveBeenCalledWith('Entry', 'id3')
    expect(onDataMiss).toBeCalledTimes(1)
    expect(multi).toHaveBeenNthCalledWith(3, [['get', 'entry:id3']])
    expect(multi).toHaveBeenNthCalledWith(4, [
      [
        'set',
        'entry:id3',
        JSON.stringify({ _id: 'id3', slug: 'slug3', title: 'Prison Break' }),
      ],
    ])
  })

  test('cacheGetMany', async () => {
    const execAsync = jest.fn(() => [null])
    const execAsyncCacheHit = jest.fn(() => [
      JSON.stringify({
        title: 'Ex Machina',
      }),
    ])
    const multi = jest.fn(([[operation, key]]) => {
      if (key === 'entry:id1') {
        return {
          execAsync: execAsyncCacheHit,
        }
      }

      return {
        execAsync,
      }
    })

    const onCacheMiss = jest.fn()
    const onDataMiss = jest.fn()

    const { cacheGetMany } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      redis: {
        multi,
      },
      onCacheMiss,
      onDataMiss,
    })

    expect(await cacheGetMany(['id1'])).toMatchObject([
      {
        title: 'Ex Machina',
      },
    ])
    expect(multi).toBeCalledTimes(1)

    expect(await cacheGetMany(['id2'])).toMatchObject([null])
    expect(multi).toBeCalledTimes(2)
  })
})

describe('clear cache', () => {
  test('cacheClearMany', async () => {
    const execAsync = jest.fn()
    const multi = jest.fn(() => ({
      execAsync,
    }))

    const { cacheClearMany } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      redis: {
        multi,
      },
    })

    await cacheClearMany(['id1', 'id3', 'id5'])
    expect(multi).toBeCalledTimes(1)
    expect(multi).toHaveBeenCalledWith([
      ['del', 'entry:id1'],
      ['del', 'entry:id3'],
      ['del', 'entry:id5'],
    ])
  })

  test('cacheClear', async () => {
    const execAsync = jest.fn()
    const multi = jest.fn(() => ({
      execAsync,
    }))

    const { cacheClear } = createCacheMethods({
      ...commonParams,
      model: createMockModel('Entry'),
      redis: {
        multi,
      },
    })

    await cacheClear('id5')
    expect(multi).toBeCalledTimes(1)
    expect(multi).toHaveBeenCalledWith([['del', 'entry:id5']])
  })
})
