import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts'],
        setupFiles: ['@grest-ts/testkit-vitest'],
        // Keeps testkit's isolate: false support tested; runtimes still boot fresh per file in their own workers.
        isolate: false,
        hookTimeout: 60000,
        teardownTimeout: 10000
    }
});
