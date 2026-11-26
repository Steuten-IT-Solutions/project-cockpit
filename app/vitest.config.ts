import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Nuxt's alias for shared/, used by server code that the unit tests import.
  resolve: { alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  test: {
    projects: [
      // Server logic in plain Node, without Nuxt or a database.
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'], environment: 'node' } },
      // The built server (npm run build first) against a real MariaDB (TEST_DATABASE_URL).
      { test: { name: 'integration', include: ['test/integration/**/*.test.ts'], environment: 'node', fileParallelism: false, testTimeout: 20000 } },
    ],
  },
})
