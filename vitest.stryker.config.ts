import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Fast, DB-free vitest config used ONLY by Stryker (mutation testing). It runs
// just the pure-unit lib tests — no setupFiles, so no Postgres migrate/truncate
// per mutant. Keeps a full mutation run in seconds instead of hours.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/lib/bcrypt.test.ts', 'src/lib/random.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
