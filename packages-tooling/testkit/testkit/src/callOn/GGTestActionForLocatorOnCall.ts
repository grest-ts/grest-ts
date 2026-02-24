/**
 * Test action for invoking methods via GGLocator lookup.
 *
 * Used for:
 * - @testable services (key: @testable:ClassName)
 * - Direct contract calls (key: @contract:ContractName)
 * - Custom GGLocatorKey lookups
 *
 * Extends GGTestAction to support .with() for mocks/spies and
 * response expectations like .toMatchObject(), .toEqual().
 */

import {GGTestAction, GGTestActionConfig, tActionRawData} from "../testers/GGTestAction";
import {GG_TEST_RUNNER} from "../GGTestRunner";
import {SerializedContext, TestableInvokeResult, TestableIPC} from "./TestableIPC";
import {GGTestError} from "../utils/GGTestError";
import {GGContext} from "@grest-ts/context";
import type {GGTestRuntime} from "../GGTestRuntime";

/**
 * Serialize a GGContext to a plain object for IPC transfer.
 * Flattens the context hierarchy into a single object.
 */
function serializeContext(ctx: GGContext): SerializedContext {
    const result: SerializedContext = {};
    // Access the private values map via type assertion
    const ctxAny = ctx as any;
    if (ctxAny.values instanceof Map) {
        for (const [key, value] of ctxAny.values) {
            result[key] = value;
        }
    }
    // Also serialize parent context values (child values take precedence)
    if (ctxAny.parent) {
        const parentValues = serializeContext(ctxAny.parent);
        return {...parentValues, ...result};
    }
    return result;
}

/**
 * Action for invoking a method via GGLocator lookup over IPC.
 *
 * @typeParam T - The expected return type of the method
 */
export class GGTestActionForLocatorOnCall<T> extends GGTestAction<T> {

    private readonly keyName: string;
    private readonly methodName: string;
    private readonly args: any[];
    private readonly targetRuntimes?: GGTestRuntime[];

    constructor(ctx: GGContext, keyName: string, methodName: string, args: any[], targetRuntimes?: GGTestRuntime[]) {
        const config: GGTestActionConfig = {
            noResponse: false,
            logData: {
                message: `[${keyName}.${methodName}]`,
                request: args.length > 0 ? args : undefined
            }
        };
        super(ctx, config);
        this.keyName = keyName;
        this.methodName = methodName;
        this.args = args;
        this.targetRuntimes = targetRuntimes;
    }

    // -------------------------------------------------
    // Action execution
    // -------------------------------------------------

    protected async executeAction(): Promise<tActionRawData> {
        const runner = GG_TEST_RUNNER.get();

        // Use target runtimes if provided, otherwise all runtimes
        const searchRuntimes = this.targetRuntimes ?? runner.getAllRuntimes();

        // Find runtimes that have this key registered
        const candidates = searchRuntimes.filter(r => r.hasLocatorKey(this.keyName));

        if (candidates.length === 0) {
            // No runtime has this key - provide helpful error
            const allRuntimes = runner.getAllRuntimes();
            if (allRuntimes.length === 0) {
                throw new GGTestError({
                    test: `No runtimes available to invoke ${this.keyName}.${this.methodName}`,
                    expected: "At least one runtime to be started",
                    received: "No runtimes found"
                });
            }
            throw new GGTestError({
                test: `Instance '${this.keyName}' not found in any runtime`,
                expected: `A @testable instance registered with key '${this.keyName}'`,
                received: `Key not registered in any of ${allRuntimes.length} runtime(s): ${allRuntimes.map(r => r.name).join(', ')}`
            });
        }

        if (candidates.length > 1) {
            // Check if all candidates are the same runtime class - if so, just use first one
            const uniqueClassNames = new Set(candidates.map(r => r.className));
            if (uniqueClassNames.size > 1) {
                // Different runtime classes have this key - actual ambiguity
                throw new GGTestError({
                    test: `Multiple different runtimes have '${this.keyName}' registered`,
                    expected: `Key '${this.keyName}' to be unique across different runtime classes, or use explicit runtime targeting`,
                    received: `Found in ${candidates.length} runtimes with different classes: ${[...uniqueClassNames].join(', ')}`
                });
            }
            // Same runtime class - just use first instance (they're identical)
        }

        // Exactly one runtime has this key - send IPC directly
        const runtime = candidates[0];
        const context = this.ctx ? serializeContext(this.ctx) : undefined;

        const result: TestableInvokeResult = await runtime.sendCommand(TestableIPC.invoke, {
            keyName: this.keyName,
            methodName: this.methodName,
            args: this.args,
            context
        });

        if (result.success) {
            return result.result as tActionRawData;
        }

        throw new GGTestError({
            test: `Error invoking ${this.keyName}.${this.methodName}`,
            expected: "Method to execute successfully",
            received: result.error || "Unknown error",
            extra: result.stack
        });
    }
}
