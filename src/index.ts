import createDebug from 'debug'
import pluralize from 'pluralize'
import createCacheMethods from './createCacheMethods'

const debug = createDebug('Mongoose:plugin:cache')

interface Context {
  enable: boolean
  redis?: any
  additionalCacheKeys?: string[]
  onCacheMiss?: Function
  onDataMiss?: Function
}

const createCachePlugin = ({
  redis,
  enable = false,
  additionalCacheKeys = [],
  onCacheMiss,
}: Context) => {
  const context = {
    redis,
    enable,
    additionalCacheKeys,
    onCacheMiss,
  }

  const onSave = async doc => {
    if (!enable) {
      return
    }

    debug('onSave', doc)
    const model = doc.constructor

    const { cacheSet } = createCacheMethods({
      ...context,
      model,
    })

    await cacheSet(doc._id, doc.toObject())

    for (const key of additionalCacheKeys) {
      await cacheSet(doc[key], doc.toObject())
    }
  }

  const onRemove = async doc => {
    if (!enable) {
      return
    }

    debug('onRemove', doc)

    if (!doc) {
      return
    }

    const model = doc.constructor

    const { cacheClear } = createCacheMethods({
      ...context,
      model,
    })

    await cacheClear(doc._id)

    for (const key of additionalCacheKeys) {
      await cacheClear(doc[key])
    }
  }

  const MONGOOSE_CREATE_OR_UPDATE_METHODS = ['save', 'findOneAndUpdate']
  const MONGOOSE_REMOVE_METHODS = ['findOneAndRemove', 'findOneAndDelete']

  return schema => {
    MONGOOSE_CREATE_OR_UPDATE_METHODS.forEach(methodName => {
      schema.post(methodName, onSave)
    })

    // This method sends a remove command directly to MongoDB, no Mongoose documents are involved. Because no Mongoose documents are involved, no middleware (hooks) are executed.
    MONGOOSE_REMOVE_METHODS.forEach(methodName => {
      schema.post(methodName, onRemove)
    })

    schema.statics.clear = async function(key: string) {
      const { cacheClear } = createCacheMethods({
        ...context,
        model: this,
      })

      return cacheClear(key)
    }

    schema.statics.clearMany = async function(keys: string[]) {
      const { cacheClearMany } = createCacheMethods({
        ...context,
        model: this,
      })

      return cacheClearMany(keys)
    }

    schema.statics.get = async function(key: string | Array<string>) {
      const { cacheGet, cacheGetMany } = createCacheMethods({
        ...context,
        model: this,
      })

      if (Array.isArray(key)) {
        return cacheGetMany(key)
      }

      return cacheGet(key)
    }

    schema.statics.getBy = async function(
      cacheKey: string,
      key: string | Array<string>,
    ) {
      const { cacheGetBy, cacheGetManyBy } = createCacheMethods({
        ...context,
        model: this,
      })

      if (Array.isArray(key)) {
        return cacheGetManyBy(cacheKey, key)
      }

      return cacheGetBy(cacheKey, key)
    }

    schema.statics.getMany = async function(keys: string[]) {
      const { cacheGetMany } = createCacheMethods({
        ...context,
        model: this,
      })

      return cacheGetMany(keys)
    }

    schema.statics.getManyBy = async function(
      cacheKey: string,
      keys: string[],
    ) {
      const { cacheGetManyBy } = createCacheMethods({
        ...context,
        model: this,
      })

      return cacheGetManyBy(cacheKey, keys)
    }

    additionalCacheKeys.forEach(cacheKey => {
      const capitalized = cacheKey.charAt(0).toUpperCase() + cacheKey.substr(1)

      schema.statics[`getBy${capitalized}`] = async function(
        key: string | Array<string>,
      ) {
        const { cacheGetBy, cacheGetManyBy } = createCacheMethods({
          ...context,
          model: this,
        })

        if (Array.isArray(key)) {
          return cacheGetManyBy(cacheKey, key)
        }

        return cacheGetBy(cacheKey, key)
      }

      schema.statics[`getBy${pluralize(capitalized)}`] = async function(keys) {
        const { cacheGetManyBy } = createCacheMethods({
          ...context,
          model: this,
        })

        return cacheGetManyBy(cacheKey, keys)
      }
    })
  }
}

export default createCachePlugin
