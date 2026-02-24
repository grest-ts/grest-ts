/**
 * Selector extension that adds targeted callOn to selectors.
 *
 * This allows explicitly targeting specific runtimes when multiple
 * different runtime classes have the same service registered.
 *
 * @example
 * const f = GGTest.startWorker({chain: ChainRuntime, weather: WeatherOnlyRuntime});
 *
 * // Both have WeatherService - explicitly target one:
 * await f.chain.callOn(WeatherService).getWeather("Test").toMatchObject({...})
 * await f.weather.callOn(WeatherService).getWeather("Test").toMatchObject({...})
 */

import {GGContext} from "@grest-ts/context";
import {GGTestSelector, GGTestSelectorExtension} from "../testers/GGTestSelector";
import {RuntimeConstructor} from "../testers/RuntimeSelector";
import {callOnTargeted, GGTestCallOn} from "./callOn";
import type {GGTestRuntime} from "../GGTestRuntime";

/**
 * Type for the callable callOn extension.
 * Can be called as a function to invoke targeted callOn.
 */
export interface GGCallOnSelectorCallable {
    <T>(target: T, ctx?: GGContext): GGTestCallOn<T>;
}

/**
 * Extension that adds .callOn() as a callable to Selectors.
 * Uses the selector's runtimes to target specific instances.
 *
 * Returns a callable that can be used directly: f.chain.callOn(WeatherService)
 */
export class GGCallOnSelector extends GGTestSelectorExtension {

    public static readonly PROPERTY_NAME = "callOn";

    constructor(runtimes: GGTestRuntime[]) {
        super(runtimes);
        // Return a callable function instead of this instance
        const callable = <T>(target: T, ctx?: GGContext): GGTestCallOn<T> => {
            return callOnTargeted(target, runtimes, ctx);
        };
        return callable as unknown as this;
    }
}

// Declaration merging to add 'callOn' to SelectorExtensions
declare module "@grest-ts/testkit" {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface SelectorExtensions<T extends RuntimeConstructor[]> {
        callOn: GGCallOnSelectorCallable;
    }
}

// Ensure RuntimeConstructor import is recognized (for declaration merging above)
export type _RuntimeConstructorRef = RuntimeConstructor;

// Register the extension
GGTestSelector.addExtension(GGCallOnSelector);
