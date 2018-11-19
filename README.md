# mongoose-plugin-cache

Seamlessly boost your MongoDB performance with Redis

[![Build Status](https://travis-ci.org/yhjor/mongoose-plugin-cache.svg?branch=master)](https://travis-ci.org/yhjor/mongoose-plugin-cache)

## Why mongoose-plugin-cache?

- Performance: Significantly enhance the overall User Experience by resolving the data from memory.
- Efficiency: Cache with peace of mind. It handles the cache synchronization with Mongoose `create`, `findByIdAndUpdate`, `findOneAndUpdate`, `findByIdAndDelete` and `findOneAndDelete` hooks, so you don't have to.
- Flexible: Enable only the model you want to cache as well as specifying the additional cache keys to resolve.

##

> Prerequisite: Mongoose 5. One of the biggest updates from Mongoose 4 to 5 is the synchronous and stability of hook, which helps get the data in sync easily.

## Installation

```bash
yarn add mongoose-plugin-cache
```

## Getting Started

```typescript
import mongoose from 'mongoose'
import createCachePlugin from 'mongoose-plugin-cache'
import redis from './redis'

const schema = new mongoose.Schema({
  name: String,
  email: String,
})

schema.plugin(
  createCachePlugin({
    // your own node_redis instance
    // keep all your preferences like cache prefix, caching strategy, and global promise to be used
    redis,
    // it will use Redis only if you enable it (default: false),
    // and you may only want to enable for the model with high frequency database access
    enable: true,
  }),
)

const User = mongoose.model('User', schema)
```

## Basic Usage

### Resolving from Cache

It first tries to resolve the value from the cache by a given ID. If it hits the cache, the value will be returned directly from Redis. If it does not hit the cache, it will resolve the data from the database and set it into Redis, `onCacheMiss` will be called. If there is no such data, `onDataMiss` hook will be called.

With Mongoose only, we normally do:

```typescript
const user = await User.findById('<userId>')
```

Instead of using `findById` or `findOne`, an extra methods `get` is provided for cache retrieval:

```typescript
const user = await User.get('<userId>')
```

### Batch Operation

It performs the same cache resolve logic, but the responses will always match their corresponding ID index location and resolves it with `null` if there is no data from the Database. It also runs data retrieval for those who have cache miss in batch to reduce the IO operation.

With Mongoose only, we do:

```typescript
const userIds = ['<userId1>', '<userId2>']

const users = await User.find({
  _id: {
    $in: userIds,
  },
})
```

An extra method `getMany` is provided for batch cache retrieval:

```typescript
const users = await User.getMany(userIds)
```

### Clearing the Cache

Clearing the cache will only remove the matching cache in Redis. The data in the database is not affected.

```typescript
await User.clear('<userId>')
await User.clearMany(['<userId1>', '<userId2>', '<slug1>', '<slug2>'])
```

## Advance Usage

### Additional Cache Keys

Sometimes we might use fields other than `_id` to resolve the data. For instance, `username` and `email` are often considered unique in a User model. Plus, for security reason, the client application normally does not manipulate the ID directly. Instead of mapping the actual ID to a particular field, you can provide an option called `additionalCacheKeys` to the plugin, and it will add an index to MongoDB and map it with the corresponding `_id` for the resolve.

```typescript
schema.plugin(
  createCachePlugin({
    ...options,
    additionalCacheKeys: ['slug'],
  }),
)

const Entry = mongoose.model('Entry', schema)

// getBy with an extra param is equivalent to getBySlug
await Entry.getBy('slug', '<slug>')
await Entry.getBySlug('<slug>')

// it also supports batching
await Entry.getBySlug(['<slug1>', '<slug2>'])
await Entry.getBySlugs(['<slug1>', '<slug2>'])
```

### Metrics

Sometimes, you may want to be notified when there is a cache miss or data miss event to strengthen the control over the data.

```typescript
schema.plugin(
  createCachePlugin({
    ...options,
    onCacheMiss: (modelName: string, key: string) => {
      console.log(`cache_miss.${modelName}.${key}`)
    },
    onDataMiss: (modelName: string, key: string) => {
      console.log(`cache_data_miss.${modelName}.${key}`)
    },
  }),
)
```

### Using with Dataloader and GraphQL

`mongoose-plugin-cache` works perfectly with Dataloader and GraphQL. It is encouraged to create a new DataLoader per request and combines it with the shared cache compatibility with `mongoose-plugin-cache` to further reduce the number of database access.

```typescript
import Dataloader from 'dataloader'
const userLoader = new DataLoader(ids => User.getMany(ids))
```

And call it with:

```typescript
await userLoader.load('<userId>')
```

With GraphQL's field resolver, you don't even have to use Mongoose's `.populate()` with better Separation of Concern.

Consider the following Mongoose schema design:

```typescript
{
  ...userFields,
  authorId: { type: Schema.Types.ObjectId, ref: 'User' }
}
```

And the following GraphQL type definition:

```graphql
type Entry {
  id: ID!
  slug: ID!
  title: String
  author: User
}
```

We can resolve the actual User using GraphQL field resolver with the combination with Dataloader:

```typescript
{
  author: ({authorId}, _, {userLoader}) => userLoader.load(authorId),
}
```

## Testing

```sh
yarn test
```

## Related Projects

- [mongoose-redis-cache](https://github.com/conancat/mongoose-redis-cache): Not actively maintained since 2014.
- [Cachegoose](https://github.com/boblauer/cachegoose)
- [mongoose-cache](https://github.com/Gottox/mongoose-cache)
- [mongoose-cachebox](https://github.com/cayasso/mongoose-cachebox)
- [mongoose-cache-manager](https://github.com/englercj/mongoose-cache-manager)

## Contributing

Please read [CONTRIBUTING.md](https://github.com/yhjor/mongoose-plugin-cache/blob/master/CONTRIBUTING.md) for details, and feel free to submit pull requests to us.
