/**
 * @grest-ts/testkit - Component testing library
 */

// Core test framework
import path from "path";
import {fileURLToPath} from "url";
import {WorkerRunner} from "./runner/WorkerRunner";
import {IsolatedRunner} from "./runner/IsolatedRunner";

export * from './GGTest'
export * from './GGTestRunner'
export * from './IGGLocalDiscoveryServer'
export * from './GGTestRuntime'
export * from './testers/GGTestComponent'
export * from './mockable/GGMockable'
export * from './mockable/GGMockableCall'
export * from './mockable/mockable'
export * from './GGTestContext'

// Mockable component server (import triggers factory registration)
export * from './mockable/GGMockableInterceptorsServer'

// Testable - direct service invocation from tests
export * from './callOn/callOn'
export * from './callOn/GGTestActionForLocatorOnCall'
export * from './callOn/GGCallOnSelector'

// Contract registration - patches GGContractClass.implement() to auto-register
import './callOn/GGContractClass.implement'

// Control channel for runtime config updates
export * from './GGTestRuntimeWorker'

// Test utilities - core infrastructure
export * from './testers/IGGTestWith'
export * from './testers/GGTestAction'
export * from './testers/GGMockWith'
export * from './testers/GGSpyWith'
export * from './testers/GGCallInterceptor'
export * from './utils/GGExpectations'
export * from './utils/GGTestError'
export {captureStackSourceFile} from './utils/captureStack'
export * from './GGTestSharedRef'

// Production bundle DCE verification
export * from './GGBundleTest'

// Mockable interceptor
export * from './mockable/GGMockableInterceptor'

// Selector system for runtime access
export * from './testers/GGTestSelector'
export * from './testers/RuntimeSelector'

// Worker runner (path configured by @grest-ts/testkit-vitest)
export * from './runner/WorkerRunner'

export type * from "./testers/IGGTestWith";
export type * from "./testers/IGGTestInterceptor";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
WorkerRunner.setWorkerLoaderPath(path.join(__dirname, 'runner', 'worker-loader.mjs'));
IsolatedRunner.setIsolatedLoaderPath(path.join(__dirname, 'runner', 'isolated-loader.mjs'));
