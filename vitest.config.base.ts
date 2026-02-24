import type {ViteUserConfig} from 'vitest/config';

export default {
    test: {
        globals: true,
        environment: 'node',
        include: ['**/*.test.ts', '**/*.spec.ts'],
        globalSetup: ['@grest-ts/testkit-vitest/globalSetup'],
        setupFiles: ['@grest-ts/testkit-vitest'],
        maxConcurrency: 8,
        fileParallelism: true,
        passWithNoTests: true, // Don't fail when a package has no test files
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/*.spec.ts',
                'src/**/*.test.ts',
                '**/*.gen.ts',
                '**/gen/**'
            ]
        }
    }
} satisfies ViteUserConfig;
