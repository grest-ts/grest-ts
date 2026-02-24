import type {GGTestRuntime} from "../GGTestRuntime";

/**
 * Constructor type for a runtime class that has a static NAME property.
 * This enforces that all runtimes used with the selector system define NAME.
 *
 * Note: We use `unknown` instead of `GGRuntime` to avoid circular dependency
 * between @grest-ts/testkit and @grest-ts/runtime.
 */
export interface RuntimeConstructor<N extends string = string> {
    new(): unknown;

    /** Name of the runtime - must be unique across all runtimes */
    readonly NAME: N;
    /** Source path set by GGRuntime.cli() - used for worker/isolated modes */
    readonly SOURCE_MODULE_URL?: string;
}

/**
 * Extension interface for selector capabilities.
 * Modules augment this interface to add their accessors (config, logs, metrics, etc.)
 *
 * @example
 * // In @grest-ts/config module:
 * declare module '@grest-ts/testkit' {
 *   interface SelectorExtensions<T extends RuntimeConstructor[]> {
 *     config: GGTestConfigAccessor<T>;
 *   }
 * }
 */
export interface SelectorExtensions<T extends RuntimeConstructor[]> {
    // Base interface - modules add properties via declaration merging
}

/**
 * Selector for a group of runtime instances.
 * Provides access to selected runtimes and their extension accessors.
 *
 * @example
 * const t = GGTest.startWorker(MainRuntime);
 * t.logs.cursor();
 * t[0].logs.cursor();
 * await t.stop();
 */
export interface Selector<T extends RuntimeConstructor[]> extends SelectorExtensions<T> {
    /**
     * Get the underlying runtime instances
     */
    readonly runtimes: GGTestRuntime[];

    /**
     * Access individual instance by index
     */
    [index: number]: Selector<[T[number]]>;

    /**
     * Number of selected instances
     */
    readonly length: number;

    /**
     * Stop runtimes (teardown services but keep IPC alive for log retrieval).
     * After stop(), you can still call commands like log retrieval.
     */
    stop(): Promise<void>;

    /**
     * Fully shutdown runtimes (terminate workers/processes).
     * After shutdown(), no commands can be sent.
     */
    shutdown(): Promise<void>;
}

// ============================================================================
// Input types for startWorker/startInline/startIsolated
// ============================================================================

/**
 * Input can be a single runtime, array of runtimes, or object mapping names to runtimes.
 */
export type RuntimeInput =
    | RuntimeConstructor
    | RuntimeConstructor[]
    | Record<string, RuntimeConstructor | RuntimeConstructor[]>;

/**
 * Normalize a single runtime or array to always be an array.
 */
type NormalizeToArray<T> = T extends RuntimeConstructor[] ? T : [T];

/**
 * Result type for object input: each key maps to a Selector.
 */
export type ObjectResult<T extends Record<string, RuntimeConstructor | RuntimeConstructor[]>> = {
    [K in keyof T]: Selector<NormalizeToArray<T[K]>>;
} & {
    /**
     * Stop all runtimes in this group.
     */
    stop(): Promise<void>;

    /**
     * Shutdown all runtimes in this group.
     */
    shutdown(): Promise<void>;
};

/**
 * Result type based on input shape:
 * - Single runtime → Selector
 * - Array of runtimes → Selector
 * - Object → ObjectResult with named selectors
 */
export type StartResult<T extends RuntimeInput> =
    T extends Record<string, RuntimeConstructor | RuntimeConstructor[]>
        ? ObjectResult<T>
        : T extends RuntimeConstructor[]
            ? Selector<T>
            : T extends RuntimeConstructor
                ? Selector<[T]>
                : never;

// ============================================================================
// Legacy RuntimeResult (for backwards compatibility with .get())
// ============================================================================

/**
 * @deprecated Use the new startWorker overloads instead.
 * Legacy result type that provides .get() method.
 */
export interface RuntimeResult<T extends RuntimeConstructor[]> {
    /**
     * Get selector for a specific runtime type
     */
    get<R extends T[number]>(runtime: R): Selector<[R]>;

    /**
     * Get selector for all runtimes
     */
    all(): Selector<T>;

    /**
     * Stop all runtimes.
     */
    stop(): Promise<void>;

    /**
     * Shutdown all runtimes.
     */
    shutdown(): Promise<void>;
}
