import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts'],
        globalSetup: ['@grest-ts/testkit-vitest/globalSetup'],
        setupFiles: ['@grest-ts/testkit-vitest'],
        // Keeps testkit's isolate: false support tested, runtime worker reuse included; vitest.isolated.config.ts covers the default.
        isolate: false,
        hookTimeout: 60000,
        teardownTimeout: 10000
    }
});
