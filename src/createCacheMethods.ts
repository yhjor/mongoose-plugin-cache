import keyBy from 'lodash.keyby'
import createDebug from 'debug'

interface Context {
  enable: boolean
  redis?: any
  additionalCacheKeys?: string[]
  onCacheMiss?: Function
  onDataMiss?: Function
  model?: any
}

const debug = createDebug('Mongoose:plugin:cache')

const createCacheMethods = ({
  enable,
  additionalCacheKeys = [],
  model,
  redis,
  onCacheMiss,
  onDataMiss,
}: Context) => {
  const name = model.modelName

  const withCachePrefix = (key: string): string =>
    `${name.toLowerCase()}:${key}`

  const onBatchCacheMiss = (keys: string[]): void => {
    keys.forEach(key => {
      debug('onCacheMiss', key)

      if (onCacheMiss) {
        onCacheMiss(name, key)
      }
    })
  }

  const onBatchDataMiss = (keys: string[]): void => {
    keys.forEach(key => {
      debug('onDataMiss', key)

      if (onDataMiss) {
        onDataMiss(name, key)
      }
    })
  }

  const getManyBy = async (
    queryKey: string,
    keys: string[],
  ): Promise<Array<any>> => {
    const keyLookup = queryKey === 'id' ? '_id' : queryKey

    const docs = await model.find({
      [keyLookup]: {
        $in: keys,
      },
    })

    const valueByKey: any = keyBy(docs, queryKey)

    return keys.map(key => {
      const value = valueByKey[key]

      if (!value) {
        onBatchDataMiss([key])
        return null
      }

      return value.toObject()
    })
  }

  const getBy = async (queryKey: string, key: string) => {
    const [value] = await getManyBy(queryKey, [key])
    return value
  }

  const cacheSetMany = async (entries: Array<[string, any]>) => {
    if (!enable) {
      return
    }

    const batch = entries.reduce((operations, [key, value]) => {
      if (!value) {
        return operations
      }

      operations.push(['set', withCachePrefix(key), JSON.stringify(value)])
      return operations
    }, [])

    if (batch.length === 0) {
      return
    }

    return redis.multi(batch).execAsync()
  }

  const cacheSet = async (key: string, value: any) => {
    await cacheSetMany([[key, value]])
  }

  const cacheGetManyBy = async (cacheKey: string = '_id', keys: string[]) => {
    if (!enable) {
      return getManyBy(cacheKey, keys)
    }

    const batchGet = keys.map(key => ['get', withCachePrefix(key)])
    const cachedData = await redis.multi(batchGet).execAsync()

    const cachedKeyValue = keys.reduce((total, key, index) => {
      const doc = cachedData[index]

      if (doc) {
        total[key] = JSON.parse(doc)
      }

      return total
    }, {})

    const missedKeysFromCache = keys.filter(key => !cachedKeyValue[key])

    if (missedKeysFromCache.length > 0) {
      onBatchCacheMiss(missedKeysFromCache)
      const storedData = await getManyBy(cacheKey, missedKeysFromCache)

      const storedDataEntries = Object.entries(
        keyBy(storedData.filter(item => !!item), cacheKey),
      )

      const storedKeyValue = storedDataEntries.reduce((total, [key, value]) => {
        if (value) {
          total[key] = value

          // cache optional additional key by option field additionalCacheKeys
          additionalCacheKeys.forEach(additionalCacheKey => {
            total[value[additionalCacheKey]] = value
          })
        }

        return total
      }, {})

      await cacheSetMany(Object.entries(storedKeyValue))

      const responseKeyValue = {
        ...cachedKeyValue,
        ...storedKeyValue,
      }

      return keys.map(key => responseKeyValue[key] || null)
    }

    return keys.map(key => cachedKeyValue[key] || null)
  }

  const cacheGetBy = async (cacheKey: string, key: string) => {
    const [value] = await cacheGetManyBy(cacheKey, [key])
    return value
  }

  const cacheGetMany = async (keys: string[]) => cacheGetManyBy('_id', keys)

  const cacheGet = (key: string) => cacheGetBy('_id', key)

  const cacheClearMany = async (keys: string[]) => {
    const batch = keys.map(key => ['del', withCachePrefix(key)])
    await redis.multi(batch).execAsync()
  }

  const cacheClear = async (key: string) => {
    await cacheClearMany([key])
  }

  return {
    withCachePrefix,
    onBatchCacheMiss,
    onBatchDataMiss,
    getManyBy,
    getBy,
    cacheSet,
    cacheSetMany,
    cacheGet,
    cacheGetBy,
    cacheGetMany,
    cacheGetManyBy,
    cacheClear,
    cacheClearMany,
  }
}

export default createCacheMethods
