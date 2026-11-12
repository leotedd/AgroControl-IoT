import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false, // una sola base temporal compartida
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
