import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['test/**/*.test.ts'],
        globalSetup: ['@grest-ts/testkit-vitest/globalSetup'],
        setupFiles: [
            '@grest-ts/testkit-vitest',
        ],
        hookTimeout: 60000,
        teardownTimeout: 10000,
    }
});
