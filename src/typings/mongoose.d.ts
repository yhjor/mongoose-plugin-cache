declare module 'mongoose' {
  interface Model<T extends Document> {
    set: (key: string, value: string) => Promise<any>
    setMany: (entries: Array<[any, any]>) => Promise<any>
    clear: (key: string) => Promise<any>
    clearMany: (keys: string[]) => Promise<any>
    get: (key: string | Array<string>) => Promise<any>
    getBy: (queryKey: string, key: string | Array<string>) => Promise<any>
    getMany: (keys: string[]) => Promise<any>
    getManyBy: (queryKey: string, keys: string[]) => Promise<any>

    // Support dynamic keys specified in additionalCacheKeys
    [key: string]: any
  }
}
