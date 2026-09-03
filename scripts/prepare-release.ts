import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, process.argv[2] ?? 'release/uni_modules/gio-uniapp-autotracker')
const allowed = ['README.md', 'index.ts', 'vite.ts', 'tsconfig.json', 'core', 'runtime', 'platform', 'autotrack', 'doc']
const forbidden = ['demo', 'test', 'scripts', 'pnpm-lock.yaml', '.git', '.env']

function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false)
}

async function main(): Promise<void> {
  const outputRelative = relative(root, output)
  if (outputRelative === '' || outputRelative.startsWith('..')) throw new Error('release_output_must_be_inside_workspace')
  if (await exists(output)) throw new Error(`release_output_exists:${outputRelative}`)

  await mkdir(output, { recursive: true })
  for (const entry of allowed) await cp(resolve(root, entry), resolve(output, entry), { recursive: true })

  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>
  const releasePackage = {
    ...packageJson,
    private: false,
    exports: { '.': './index.ts', './vite': './vite.ts' },
    types: './index.ts',
    scripts: undefined,
    devDependencies: undefined,
  }
  await writeFile(resolve(output, 'package.json'), `${JSON.stringify(releasePackage, null, 2)}\n`, 'utf8')

  for (const entry of forbidden) {
    if (await exists(resolve(output, entry))) throw new Error(`release_forbidden_content:${entry}`)
  }
  process.stdout.write(`release_ready:${outputRelative}\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'release_prepare_failed'}\n`)
  process.exitCode = 1
})
