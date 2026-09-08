import metadata from '../package.json' with { type: 'json' }

export const SDK_VERSION: string = metadata.version
