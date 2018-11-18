import mongoose from 'mongoose'
import MongoMemoryServer from 'mongodb-memory-server'

// May require additional time for downloading MongoDB binaries at the first time
jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000

mongoose.Promise = global.Promise

const mongoServer = new MongoMemoryServer()

const connect = async (uri?: string) => {
  const mongoUri = uri || (await mongoServer.getConnectionString())

  return mongoose
    .connect(mongoUri)
    .then(() => {
      console.info('MongoDb connected!')
    })
    .catch(console.error)
}

const disconnect = async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
}

export { connect, disconnect }
