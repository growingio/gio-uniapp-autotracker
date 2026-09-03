import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'demo/uni_modules/gio-uniapp-autotracker')

async function main(): Promise<void> {
  const sourcePackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>
  const packageJson = {
    ...sourcePackage,
    private: false,
    exports: { '.': './index.js', './vite': './vite.js', './autotrack': './autotrack.js' },
    types: './index.d.ts',
    scripts: undefined,
    devDependencies: undefined,
  }

  await mkdir(output, { recursive: true })
  await cp(resolve(root, 'README.md'), resolve(output, 'README.md'))
  await cp(resolve(root, 'doc'), resolve(output, 'doc'), { recursive: true })
  await writeFile(resolve(output, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'sdk_dist_prepare_failed'}\n`)
  process.exitCode = 1
})
