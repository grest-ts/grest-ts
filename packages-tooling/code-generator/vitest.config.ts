// ---------------------------------------------
// THIS FILE IS GENERATED - DO NOT EDIT
// ---------------------------------------------

import {defineConfig, mergeConfig} from 'vitest/config';
import baseConfig from '../../vitest.config.base';

export default defineConfig(mergeConfig(
    baseConfig,
    {
    test: {
        pool: "forks",
        fileParallelism: false,
        maxConcurrency: 1,
        sequence: {
            concurrent: false,
            groupOrder: 1
        },
        isolate: false,
        typecheck: {
            enabled: false
        }
    }
}
));
