import mongoose from 'mongoose'
import {
  connect as connectMongoDb,
  disconnect as disconnectMongoDb,
} from '../services/mongodb'
import {
  createClient as createRedisClient,
  connect as connectRedis,
} from '../services/redis'
import createCachePlugin from '../'

interface Option {
  cacheKeys?: string[]
  enable?: boolean
}

const redis = createRedisClient()

const createModel = (name: string, definition: any, option?: Option) => {
  const { cacheKeys = [], enable = true } = option || {}
  const schema = new mongoose.Schema(definition)

  schema.plugin(
    createCachePlugin({
      redis,
      enable,
      onCacheMiss: (modelName: string, key: string) => {
        console.log(`cache_miss.${modelName}.${key}`)
      },
      onDataMiss: (modelName: string, key: string) => {
        console.log(`cache_data_miss.${modelName}.${key}`)
      },
      additionalCacheKeys: cacheKeys,
    }),
  )

  return mongoose.model(name, schema)
}

const User = createModel('User', {
  name: String,
  email: String,
  username: String,
})

const Entry = createModel(
  'Entry',
  {
    title: String,
    slug: String,
  },
  {
    cacheKeys: ['slug'],
  },
)

const Comment = createModel(
  'Comment',
  {
    content: 'String',
  },
  {
    enable: false,
  },
)

beforeAll(async () => {
  await Promise.all([connectMongoDb(), connectRedis(redis)])
})

afterAll(async () => {
  await disconnectMongoDb()
})

beforeEach(async () => {
  await Promise.all([User.remove({}), redis.flushdbAsync()])
})

it('contains extra methods', async () => {
  expect(User.getMany).toBeTruthy()
  expect(User.getManyBy).toBeTruthy()
  expect(User.get).toBeTruthy()
  expect(User.getBy).toBeTruthy()
  expect(User.clear).toBeTruthy()
  expect(User.clearMany).toBeTruthy()
})

it('resolves null for non existing record', async () => {
  // Cache miss and store it to redis
  const id = mongoose.Types.ObjectId().toHexString()
  const response = await User.get(id)
  const actualResponse = await redis.getAsync(`user:${id}`)

  expect(response).toBeNull()
  expect(actualResponse).toBeNull()
})

it('clears cache', async () => {
  const user = await User.create({
    name: 'Shakira',
  })

  const id = user.toObject()._id
  expect(await redis.getAsync(`user:${id}`)).toBeTruthy()
  await User.clear(id)
  expect(await redis.getAsync(`user:${id}`)).toBeFalsy()
})

describe('hook', () => {
  it('resolves cache after creation', async () => {
    const responseFromDb = await User.create({
      name: 'Alan Walker',
    })

    const id = responseFromDb.toObject()._id

    // Cache miss and store it to redis
    const user = await User.get(id)
    const userFromCache = await redis.getAsync(`user:${id}`)

    expect(JSON.parse(userFromCache).id).toBe(user.id)

    // Cache hit
    const secondUserFromCache = await User.get(id)
    expect(JSON.parse(userFromCache).id).toBe(secondUserFromCache.id)
  })

  it('updates cache after update', async () => {
    const user = await User.create({
      name: 'Zara',
    })

    const id = user.toObject()._id
    const updatedUser: any = await User.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          name: 'Zara Larsson',
        },
      },
      { new: true },
    )

    expect(updatedUser.name).toEqual('Zara Larsson')
    expect(JSON.parse(await redis.getAsync(`user:${id}`)).name).toBe(
      'Zara Larsson',
    )
  })

  it('removes cache after removal', async () => {
    const user = await User.create({
      name: 'Selena Gomez',
    })

    const id = user.toObject()._id
    expect(await redis.getAsync(`user:${id}`)).toBeTruthy()

    await User.findByIdAndDelete(id)
    expect(await redis.getAsync(`user:${id}`)).toBeFalsy()
  })
})

describe('enable = false', () => {
  it('does not create and resolve cache', async () => {
    const comment = await Comment.create({
      content: 'dummy',
    })

    const id = comment.toObject()._id
    expect(await redis.getAsync(`comment:${id}`)).toBeFalsy()

    const commentFromCache = await Comment.get(id)
    expect(comment._id).toEqual(commentFromCache._id)
    expect(await redis.getAsync(`comment:${id}`)).toBeFalsy()
  })
})

describe('additionalCacheKeys', () => {
  it('contains additional methods', async () => {
    // without additionalCacheKeys
    expect(User.getByEmail).toBeFalsy()
    expect(User.getByUsername).toBeFalsy()

    // with additionalCacheKeys
    expect(Entry.getBySlug).toBeTruthy()
    expect(Entry.getBySlugs).toBeTruthy()
  })

  it('resolves single doc from one of the additionalCacheKeys', async () => {
    const entry: any = await Entry.create({
      title: 'The Man from Earth',
      slug: 'the-man-from-earth',
    })

    const entryResolvedBySlug = await Entry.getBySlug('the-man-from-earth')
    expect(entryResolvedBySlug.title).toEqual(entry.title)
    expect(await redis.getAsync(`entry:${entry._id}`)).toBeTruthy()
    expect(await redis.getAsync(`entry:${entry.slug}`)).toBeTruthy()
  })

  it('resolves batch docs from one of the additionalCacheKeys using singular form', async () => {
    const [entry, entry2]: [any, any] = await Promise.all([
      Entry.create({
        title: 'A Quite Place',
        slug: 'a-quite-place',
      }),
      Entry.create({
        title: 'The Truman Show',
        slug: 'the-truman-show',
      }),
    ])

    const [entryFromCache, entry2FromCache] = await Entry.getBySlug([
      'a-quite-place',
      'the-truman-show',
    ])

    expect(entryFromCache.title).toEqual(entry.title)
    expect(entry2FromCache.title).toEqual(entry2.title)

    expect(await redis.getAsync(`entry:${entry._id}`)).toBeTruthy()
    expect(await redis.getAsync(`entry:${entry.slug}`)).toBeTruthy()
    expect(await redis.getAsync(`entry:${entry2._id}`)).toBeTruthy()
    expect(await redis.getAsync(`entry:${entry2.slug}`)).toBeTruthy()
  })

  it('resolves batch docs from one of the additionalCacheKeys using plural form', async () => {
    const [entry, entry2]: [any, any] = await Promise.all([
      Entry.create({
        title: 'NSFW',
        slug: 'nsfw',
      }),
      Entry.create({
        title: 'SFW',
        slug: 'sfw',
      }),
    ])

    const [entryFromCache, entry2FromCache] = await Entry.getBySlugs([
      'nsfw',
      'sfw',
    ])

    expect(entryFromCache.title).toEqual(entry.title)
    expect(entry2FromCache.title).toEqual(entry2.title)

    expect(await redis.getAsync(`entry:${entry._id}`)).toBeTruthy()
    expect(await redis.getAsync(`entry:${entry.slug}`)).toBeTruthy()
    expect(await redis.getAsync(`entry:${entry2._id}`)).toBeTruthy()
    expect(await redis.getAsync(`entry:${entry2.slug}`)).toBeTruthy()
  })
})

describe('batch operations', () => {
  test('getMany', async () => {
    const [user1, user2] = await Promise.all([
      User.create({
        name: 'Charlie Puth',
      }),
      User.create({
        name: 'Bruno Mars',
      }),
    ])

    const id1 = user1.toObject()._id
    const id2 = user2.toObject()._id

    await Promise.all([
      redis.delAsync(`user:${id1}`),
      redis.delAsync(`user:${id2}`),
    ])

    const [response1, response2] = await User.getMany([id1, id2])

    expect(response1).toEqual(
      expect.objectContaining({
        name: 'Charlie Puth',
      }),
    )
    expect(response2).toEqual(expect.objectContaining({ name: 'Bruno Mars' }))
    expect(await redis.getAsync(`user:${id1}`)).toBeTruthy()
    expect(await redis.getAsync(`user:${id2}`)).toBeTruthy()
  })

  test('clearMany', async () => {
    const [user1, user2] = await Promise.all([
      User.create({
        name: 'Ariana Grande',
      }),
      User.create({
        name: 'Lady Gaga',
      }),
    ])

    const id1 = user1.toObject()._id
    const id2 = user2.toObject()._id

    await User.clearMany([id1, id2])

    expect(await redis.getAsync(`user:${id1}`)).toBeFalsy()
    expect(await redis.getAsync(`user:${id2}`)).toBeFalsy()
  })
})
