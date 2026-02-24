import {GGContext} from "@grest-ts/context";
import {callOn, callOnCollection, GGTestCallOn, GGTestCallOnCollection} from "./callOn/callOn";

// Note: beforeAll, beforeEach, afterEach, afterAll are vitest globals
// Do NOT import them directly - it breaks worker threads that load this module

// ============================================================================
// Test Collection Types
// ============================================================================

export class GGTestContext extends GGContext {


    public resetAfterEach(): this {
        afterEach(() => {
            this.reset();
        });
        return this;
    }

    /**
     * Register APIs and services for testing.
     * Returns `this` merged with test clients for all registered items.
     *
     * @example
     * const alice = new GGTestContext("alice")
     *     .apisV2({
     *         chain: ChainApi,           // HTTP API → test client
     *         services: {
     *             weather: WeatherService // Service class → testable access
     *         }
     *     });
     *
     * alice.chain.getWeather({...})           // HTTP test client
     * alice.services.weather.getWeather({...}) // Testable service
     */
    public apis<T extends object>(apis: T): this & GGTestCallOnCollection<T> {
        Object.assign(this, callOnCollection(apis, this));
        return this as this & GGTestCallOnCollection<T>;
    }

    /**
     * Call a method on an API or service within this context.
     * Creates and caches test clients/proxies for reuse.
     *
     * @example
     * alice.callOn(ChainApi).getWeather({city: "NYC"})
     * alice.callOn(WeatherService).getWeather("NYC")
     */
    public callOn<T extends object>(target: T): GGTestCallOn<T> {
        return callOn(target, this)
    }

    public beforeAll(callback: () => void): this {
        beforeAll(() => this.run(callback));
        return this;
    }

    public beforeEach(callback: () => void): this {
        beforeEach(() => this.run(callback));
        return this;
    }

    public afterEach(callback: () => void): this {
        afterEach(() => this.run(callback));
        return this;
    }

    public afterAll(callback: () => void): this {
        afterAll(() => this.run(callback));
        return this;
    }
}

