/**
 * IPC protocol definitions for GGLocator-based service invocation.
 *
 * Defines the messages exchanged between test runner and runtime worker
 * for invoking methods on registered instances (@testable, @contract, etc.).
 */

import {IPCClient, IPCServer} from "@grest-ts/ipc";

/**
 * Serialized context data for IPC transfer.
 * Contains flattened key-value pairs from GGContext.
 */
export type SerializedContext = Record<string, any>;

/**
 * Payload for invoking a method on a registered instance.
 */
export interface TestableInvokePayload {
    /** The GGLocatorKey name (e.g., "@testable:ServiceB", "@contract:ChainApi", or custom key) */
    keyName: string;
    /** The method name to invoke */
    methodName: string;
    /** Arguments to pass to the method (as array) */
    args: any[];
    /** Serialized GGContext data to restore on the worker side */
    context?: SerializedContext;
}

/**
 * Result from invoking a testable method.
 */
export interface TestableInvokeResult {
    /** Whether the invocation succeeded */
    success: boolean;
    /** The return value from the method (if success) */
    result?: any;
    /** Error message (if failed) */
    error?: string;
    /** Error stack trace (if failed) */
    stack?: string;
}

/**
 * Payload for registering locator keys from a runtime.
 */
export interface KeyRegistrationPayload {
    /** Runtime ID sending the registration */
    runtimeId: string;
    /** All GGLocatorKey names registered in this runtime */
    keys: string[];
}

/**
 * IPC endpoints for testable service invocation.
 */
export const TestableIPC = {
    /**
     * Messages FROM test server TO worker.
     */
    client: {
        /**
         * Invoke a method on a testable service instance.
         */
        invoke: IPCClient.defineRequest<TestableInvokePayload, TestableInvokeResult>("testable/invoke"),
    },

    /**
     * Messages FROM worker TO test server.
     */
    server: {
        /**
         * Register all locator keys available in a runtime.
         * Sent from worker to test runner after compose completes.
         */
        registerKeys: IPCServer.defineRequest<KeyRegistrationPayload, void>("testable/register-keys"),
    },

    // Legacy alias for backwards compatibility
    invoke: IPCClient.defineRequest<TestableInvokePayload, TestableInvokeResult>("testable/invoke"),
};
