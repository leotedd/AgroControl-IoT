import { defineConfig } from 'vitest/config'

// No importa dotenv ni usa fixtures con BD. Dependencias de datos simuladas.
export default defineConfig({
  test: { include: ['tests/safe/**/*.test.ts'], fileParallelism: false },
})
