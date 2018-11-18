import redis from 'redis'
import redisMock from 'redis-mock'
import bluebird from 'bluebird'

const createClient = (uri?: string) => {
  const client = uri ? redis.createClient(uri) : redisMock.createClient()

  bluebird.promisifyAll(redis.RedisClient.prototype)
  bluebird.promisifyAll(redis.Multi.prototype)

  bluebird.promisifyAll(redisMock.RedisClient.prototype)
  bluebird.promisifyAll(redisMock.Multi.prototype)

  client.on('error', console.error)
  client.on('ready', () => console.info('Redis connected!'))

  return client
}

const connect = async client => {
  await client.pingAsync()
}

export { createClient, connect }
