/**
 * ServiceC - The deepest service in the chain (simulates external API).
 *
 * This service demonstrates @testable and @mockable working together.
 * In tests, you can:
 * - Mock this service when testing ServiceB or ServiceA
 * - Invoke methods directly via testable(ServiceC)
 */

import {mockable, testable} from "@grest-ts/testkit-runtime";
import {GGLog} from "@grest-ts/logger";

export interface WeatherData {
    temperature: number;
    condition: string;
    humidity: number;
}

export interface TimezoneData {
    timezone: string;
    offset: number;
}

@testable
@mockable
export class WeatherService {

    /**
     * Simulate fetching weather data from an external API.
     */
    async getWeather(city: string): Promise<WeatherData> {
        GGLog.debug(this, `Fetching weather for ${city}`);

        // Simulate API latency
        await this.simulateLatency();

        // Return "real" weather data
        return {
            temperature: 72,
            condition: "sunny",
            humidity: 45
        };
    }

    /**
     * Simulate fetching timezone data from an external API.
     */
    async getTimezone(city: string): Promise<TimezoneData> {
        GGLog.debug(this, `Fetching timezone for ${city}`);

        await this.simulateLatency();

        return {
            timezone: "America/New_York",
            offset: -5
        };
    }

    /**
     * Simulate API latency.
     */
    private async simulateLatency(): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}
