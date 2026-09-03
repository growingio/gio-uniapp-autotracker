export const GIO_STORAGE_PREFIX = 'gio:v1:'

export type StorageKeys = Readonly<{
  identity: string
  session: string
  meta: string
  queue: string
}>

export function storageKeys(dataSourceId: string): StorageKeys {
  const prefix = `${GIO_STORAGE_PREFIX}${dataSourceId}:`
  return { identity: `${prefix}identity`, session: `${prefix}session`, meta: `${prefix}meta`, queue: `${prefix}queue:v1` }
}
