import { coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/junit.xml' },
    coverage: {
      provider: 'v8',
      all: true,
      include: ['index.ts', 'autotrack.ts', 'vite.ts', 'core/**/*.ts', 'runtime/**/*.ts', 'platform/**/*.ts', 'autotrack/**/*.ts'],
      // ports 仅声明类型，由 typecheck 检查；其余核心文件包括未被测试导入的文件全部计入。
      exclude: [...coverageConfigDefaults.exclude, 'core/ports.ts'],
      reporter: ['text', 'html', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
      thresholds: { perFile: true, lines: 90, statements: 90, functions: 85, branches: 80 },
    },
  },
})
