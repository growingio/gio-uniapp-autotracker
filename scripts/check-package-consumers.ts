import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfigFromFile } from 'vite'
import type { UniAppAutoTrackVitePlugin } from '../autotrack/vite.js'
import { archivesDir, hashes, metadata, modulesDir, npmDir, root, sdkName } from './release-layout.js'

const release = JSON.parse(await readFile(join(archivesDir, 'release.json'), 'utf8')) as { npmFile: string; npmIntegrity: string; uniFile: string; uniSha256: string; version: string }
assert.equal(release.version, metadata.version)
assert.equal(`sha512-${createHash('sha512').update(await readFile(join(archivesDir, release.npmFile))).digest('base64')}`, release.npmIntegrity)
assert.equal(createHash('sha256').update(await readFile(join(archivesDir, release.uniFile))).digest('hex'), release.uniSha256)
const temporary = await mkdtemp(join(tmpdir(), 'gio-sdk-consumers-'))
try {
  for (const channel of ['npm', 'uni_modules']) {
    const project = join(temporary, channel)
    await mkdir(project)
    const projectMetadata = { name: 'isolated-sdk-consumer', private: true }
    await writeFile(join(project, 'package.json'), JSON.stringify(projectMetadata))
    if (channel === 'npm') {
      execFileSync('npm', ['install', join(archivesDir, release.npmFile), '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', join(temporary, 'cache')], { cwd: project, stdio: 'pipe' })
    } else {
      execFileSync('tar', ['-xzf', join(archivesDir, release.uniFile), '-C', project])
    }
    const installed = channel === 'npm' ? join(project, 'node_modules', sdkName) : join(project, 'uni_modules', sdkName)
    assert.deepEqual(await hashes(installed), await hashes(channel === 'npm' ? npmDir : modulesDir), `${channel} 实际安装文件与验证过的构建产物不一致`)
    const entry = channel === 'npm' ? sdkName : `./uni_modules/${sdkName}/index.js`
    const vite = channel === 'npm' ? `${sdkName}/vite` : `./uni_modules/${sdkName}/vite.js`
    const autotrack = channel === 'npm' ? `${sdkName}/autotrack` : `./uni_modules/${sdkName}/autotrack.js`
    const runtimeImport = channel === 'npm' ? `${sdkName}/autotrack` : `@/uni_modules/${sdkName}/autotrack.js`
    // 真正解包到仓库外，不能借用仓库 node_modules 或直接导入 TS 源码。
    await writeFile(join(project, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import gdp from ${JSON.stringify(entry)};
import { gioUniappAutoTrack } from ${JSON.stringify(vite)};
import { dispatchAutoTrack } from ${JSON.stringify(autotrack)};
const requests = [], hooks = [], values = new Map();
globalThis.uni = {
  getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value), removeStorageSync: key => values.delete(key),
  getDeviceInfo: () => ({ platform: 'android', osVersion: '14' }), getSystemInfoSync: () => ({}), getAppBaseInfo: () => ({ appVersion: '2.0' }),
  getNetworkType: options => options.success({ networkType: 'wifi' }),
  request: options => { requests.push(JSON.parse(options.data)); options.success({ statusCode: 204 }); }
};
let tracker;
assert.equal(gdp('registerPlugins', [{ name: 'consumer-check', install: value => { tracker = value } }]), true);
assert.equal(gdp('init', 'account', 'source', { uniVue: { mixin: value => hooks.push(value) }, sdkVersion: 'caller-override' }), true);
assert.equal(gdp('setUserId', 'early-user'), true);
hooks[0].onLaunch.call({}, { path: 'pages/home' }); hooks[0].onShow.call({}, { path: 'pages/home' });
assert.equal(await tracker.whenReady(), true);
assert.equal(requests.flat()[0].sdkVersion, ${JSON.stringify(metadata.version)});
assert.equal(requests.flat()[0].userId, 'early-user');
const call = { kind: 'click' }; let forwarded;
tracker.autoTrack = value => { forwarded = value; return true };
assert.equal(dispatchAutoTrack(call), true); assert.equal(forwarded, call);
const plugin = gioUniappAutoTrack();
const result = plugin.transform.call({ warn: warning => { throw new Error(warning) } }, '<script setup>const save = e => e</script><template><button @click="save($event)" /></template>', 'page.vue');
assert.ok(result.code.includes(${JSON.stringify(runtimeImport)}));
console.log('consumer_passed:${channel}');
`)
    execFileSync(process.execPath, [join(project, 'consumer.mjs')], { cwd: project, stdio: 'inherit', timeout: 30_000 })
    await writeFile(join(project, 'consumer.mts'), `import gdp from ${JSON.stringify(entry)};\nimport { gioUniappAutoTrack } from ${JSON.stringify(vite)};\nimport { dispatchAutoTrack } from ${JSON.stringify(autotrack)};\ngdp('track', 'typed', { value: 0 });\ngioUniappAutoTrack();\nvoid dispatchAutoTrack;\n`)
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.mts'], { cwd: project, stdio: 'inherit', timeout: 30_000 })

    // 验证工具使用仓库锁定的 Vite；SDK 解析仍只能来自仓库外安装的交付包。
    for (const mode of ['commonjs', 'module'] as const) {
      await writeFile(join(project, 'package.json'), JSON.stringify({ ...projectMetadata, ...(mode === 'module' ? { type: 'module' } : {}) }))
      const configFile = join(project, `vite.${mode}.config.ts`)
      const source = mode === 'commonjs'
        ? `export default async () => { const { gioUniappAutoTrack } = await import(${JSON.stringify(vite)}); return { plugins: [gioUniappAutoTrack()] } }`
        : `import { gioUniappAutoTrack } from ${JSON.stringify(vite)}; export default { plugins: [gioUniappAutoTrack()] }`
      await writeFile(configFile, source)
      const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile, project, 'silent')
      assert.ok(loaded, 'Vite 配置未加载')
      const plugin = loaded.config.plugins?.[0] as UniAppAutoTrackVitePlugin
      assert.equal(plugin.name, 'gio-uniapp-autotrack')
      const transformed = plugin.transform.call({ warn: warning => { throw new Error(warning) } }, '<script setup>const save = e => e</script><template><button @click="save($event)" /></template>', 'page.vue')
      assert.ok(transformed?.code.includes(runtimeImport), `${channel}/${mode} 探针入口错误`)
      console.log(`vite_config_passed:${channel}:${mode}`)
    }
  }
} finally { await rm(temporary, { recursive: true, force: true }) }
