import {defineConfig} from 'vitest/config';
import base from './vitest.config';

// The suites that depend on how runtime workers are started, under vitest's default `isolate: true`.
export default defineConfig({
    test: {
        ...base.test,
        name: 'grest-test (isolated)',
        include: ['test/workerReuse.test.ts', 'test/clock.test.ts', 'test/mockable.test.ts'],
        isolate: true,
        env: {GG_TEST_EXPECT_ISOLATED: "1"}
    }
});
