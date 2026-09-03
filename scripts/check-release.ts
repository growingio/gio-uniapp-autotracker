import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, process.argv[2] ?? 'release/uni_modules/gio-uniapp-autotracker')
const expected = new Set(['README.md', 'autotrack', 'core', 'doc', 'index.ts', 'package.json', 'platform', 'runtime', 'tsconfig.json', 'vite.ts'])

async function main(): Promise<void> {
  const outputRelative = relative(root, output)
  if (outputRelative === '' || outputRelative.startsWith('..')) throw new Error('release_output_must_be_inside_workspace')
  await access(output)
  if (process.argv[2] === undefined) {
    const releaseRoot = resolve(root, 'release')
    const releaseEntries = await readdir(releaseRoot)
    if (releaseEntries.length !== 1 || releaseEntries[0] !== 'uni_modules') throw new Error('release_root_content_mismatch')
    const moduleEntries = await readdir(resolve(releaseRoot, 'uni_modules'))
    if (moduleEntries.length !== 1 || moduleEntries[0] !== 'gio-uniapp-autotracker') throw new Error('release_module_content_mismatch')
  }
  const actual = new Set(await readdir(output))
  if (actual.size !== expected.size || [...actual].some((entry) => !expected.has(entry))) throw new Error('release_content_mismatch')

  const packageJson = JSON.parse(await readFile(resolve(output, 'package.json'), 'utf8')) as Readonly<Record<string, unknown>>
  if (packageJson.name !== 'gio-uniapp-autotracker' || packageJson.type !== 'module' || packageJson.private !== false || packageJson.types !== './index.ts') {
    throw new Error('release_package_metadata_invalid')
  }
  if (JSON.stringify(packageJson.exports) !== JSON.stringify({ '.': './index.ts', './vite': './vite.ts' })) throw new Error('release_exports_invalid')
  if (typeof packageJson.dependencies !== 'object' || packageJson.dependencies === null || !('@vue/compiler-dom' in packageJson.dependencies)) {
    throw new Error('release_vite_dependency_missing')
  }
  if ('devDependencies' in packageJson || 'scripts' in packageJson) throw new Error('release_development_metadata_present')
  process.stdout.write(`release_checked:${outputRelative}\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'release_check_failed'}\n`)
  process.exitCode = 1
})
