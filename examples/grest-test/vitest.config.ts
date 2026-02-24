import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts'],
        setupFiles: ['@grest-ts/testkit-vitest'],
        hookTimeout: 60000,
        teardownTimeout: 10000
    }
});
