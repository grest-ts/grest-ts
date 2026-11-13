import {defineConfig} from 'vitest/config';
import base from './vitest.config';

export default defineConfig({
    test: {
        ...base.test,
        name: 'grest-test (isolated)',
        include: ['test/workerReuse.test.ts', 'test/clock.test.ts', 'test/mockable.test.ts'],
        isolate: true,
        env: {GG_TEST_EXPECT_ISOLATED: "1"}
    }
});
