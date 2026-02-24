/**
 * Worker-side handler for GGLocator-based service invocation.
 *
 * Receives IPC requests from tests to invoke methods on registered instances
 * (@testable, @contract, etc.) and returns the results.
 */

import {GGLocator, GGLocatorKey} from "@grest-ts/locator";
import {GGLog} from "@grest-ts/logger";
import {SerializedContext, TestableIPC, TestableInvokePayload, TestableInvokeResult} from "./TestableIPC";
import {GGTestRuntimeWorker} from "../GGTestRuntimeWorker";
import {GGContext} from "@grest-ts/context";

/**
 * Context for logging
 */
const LOG_CONTEXT = {name: "GGLocatorWorkerHandler"};

/**
 * Deserialize context data into a GGContext.
 * Directly populates the internal values map.
 */
function deserializeContext(data: SerializedContext): GGContext {
    const ctx = new GGContext("ipc-context");
    // Access internal values map and populate directly
    const ctxAny = ctx as any;
    for (const [keyName, value] of Object.entries(data)) {
        ctxAny.values.set(keyName, value);
    }
    return ctx;
}

/**
 * Register the locator lookup handler on the worker.
 * Called during worker initialization.
 */
export function registerOnCallHandler(worker: GGTestRuntimeWorker): void {
    worker.onIpcRequest(TestableIPC.invoke, async (payload: TestableInvokePayload): Promise<TestableInvokeResult> => {
        const {keyName, methodName, args, context} = payload;

        GGLog.debug(LOG_CONTEXT, `Invoking ${keyName}.${methodName}`, {args, hasContext: !!context});

        try {
            // Look up the instance in the current scope
            const scope = GGLocator.tryGetScope();
            if (!scope) {
                return {
                    success: false,
                    error: `No GGLocator scope available - is the runtime running?`
                };
            }

            const key = new GGLocatorKey<any>(keyName);
            const instance = scope.tryGet(key);

            if (!instance) {
                return {
                    success: false,
                    error: `Instance '${keyName}' not found in GGLocator. ` +
                        `Make sure the class is decorated with @testable or registered during compose().`
                };
            }

            // Check if method exists
            const method = instance[methodName];
            if (typeof method !== 'function') {
                return {
                    success: false,
                    error: `Method '${methodName}' not found on instance '${keyName}'. ` +
                        `Available methods: ${getMethodNames(instance).join(', ')}`
                };
            }

            // Invoke the method, optionally within the provided context
            let result: any;
            if (context) {
                const ctx = deserializeContext(context);
                result = await ctx.run(() => method.apply(instance, args));
            } else {
                result = await method.apply(instance, args);
            }

            GGLog.debug(LOG_CONTEXT, `Invocation ${keyName}.${methodName} completed`, {result});

            return {
                success: true,
                result
            };
        } catch (error: any) {
            GGLog.error(LOG_CONTEXT, `Error invoking ${keyName}.${methodName}`, error);

            return {
                success: false,
                error: error.message || String(error),
                stack: error.stack
            };
        }
    });
}

/**
 * Get method names from an instance for error messages.
 */
function getMethodNames(instance: any): string[] {
    const names: string[] = [];
    let proto = Object.getPrototypeOf(instance);

    while (proto && proto !== Object.prototype) {
        const propNames = Object.getOwnPropertyNames(proto)
            .filter(name => {
                if (name === 'constructor') return false;
                try {
                    return typeof proto[name] === 'function';
                } catch {
                    return false;
                }
            });
        names.push(...propNames);
        proto = Object.getPrototypeOf(proto);
    }

    return [...new Set(names)].sort();
}
