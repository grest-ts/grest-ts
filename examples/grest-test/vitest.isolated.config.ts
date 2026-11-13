import {defineConfig} from 'vitest/config';

// The suites that depend on how runtime workers are started, under vitest's default `isolate: true`.
export default defineConfig({
    test: {
        name: 'grest-test (isolated)',
        globals: true,
        environment: 'node',
        include: ['test/workerReuse.test.ts', 'test/clock.test.ts', 'test/mockable.test.ts'],
        globalSetup: ['@grest-ts/testkit-vitest/globalSetup'],
        setupFiles: ['@grest-ts/testkit-vitest'],
        env: {GG_TEST_EXPECT_ISOLATED: "1"},
        hookTimeout: 60000,
        teardownTimeout: 10000
    }
});
