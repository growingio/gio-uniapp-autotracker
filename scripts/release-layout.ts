import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const dist = join(root, 'dist')
export const sdkName = 'gio-uniapp-autotracker'
export const npmDir = join(dist, 'npm')
export const modulesDir = join(dist, 'uni_modules', sdkName)
export const archivesDir = join(dist, 'release')
export const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
  name: string; version: string; description: string
}
export const runtimeEntries = ['index.js', 'index.d.ts', 'autotrack.js', 'autotrack.d.ts', 'core', 'runtime', 'platform']

export async function files(directory: string, prefix = ''): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) output.push(...await files(directory, path))
    else if (entry.isFile()) output.push(path)
    else throw new Error(`release_non_regular_file:${path}`)
  }
  return output.sort()
}

export async function hashes(directory: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all((await files(directory)).map(async (file) => [file,
    createHash('sha256').update(await readFile(join(directory, file))).digest('hex')])))
}

export async function sourceHash(): Promise<string> {
  const inputs = ['index.ts', 'autotrack.ts', 'vite.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'tsconfig.build.json', '.github/workflows/publish.yml', 'README.md', 'LICENSE']
  for (const directory of ['core', 'runtime', 'platform', 'autotrack', 'doc', 'scripts']) inputs.push(...(await files(join(root, directory))).map((file) => `${directory}/${file}`))
  const hash = createHash('sha256')
  for (const file of inputs.sort()) hash.update(file).update('\0').update(await readFile(join(root, file))).update('\0')
  return hash.digest('hex')
}
