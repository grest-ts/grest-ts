import type {GGTestRunner} from "../GGTestRunner";

/**
 * Interface for test components that can be registered with GGTestRunner.
 * Components must accept GGTestRunner as their constructor argument.
 */
export interface GGTestComponent {
    start?(): Promise<void>;
    beforeAll?(): Promise<void>;
    afterAll?(): Promise<void>;
    beforeEach?(): Promise<void>;
    afterEach?(): Promise<void>;
    teardown?(): Promise<void>;
}

/**
 * Constructor type for components. All components must accept GGTestRunner as constructor argument.
 */
export type GGTestComponentType<T extends GGTestComponent> = new (runner: GGTestRunner) => T;
