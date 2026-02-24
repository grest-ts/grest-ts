/**
 * ServiceB - Middle layer service in the chain.
 *
 * Depends on ServiceC for external data.
 * Demonstrates:
 * - Dependency injection via constructor
 * - @testable and @mockable working together
 * - Can be mocked when testing ServiceA
 * - Can be invoked directly, with ServiceC automatically available
 */

import {testable, mockable} from "@grest-ts/testkit-runtime";
import {GGLog} from "@grest-ts/logger";
import {WeatherService, WeatherData, TimezoneData} from "./WeatherService";

export interface CityInfo {
    city: string;
    weather: WeatherData;
    timezone: TimezoneData;
}

export interface CityComparison {
    cities: CityInfo[];
    warmest: string;
    coldest: string;
}

@testable
@mockable
export class CityService {

    constructor(private readonly weather: WeatherService) {
    }

    /**
     * Get comprehensive information about a city.
     * Aggregates data from ServiceC.
     */
    async getCityInfo(city: string): Promise<CityInfo> {
        GGLog.debug(this, `Getting info for ${city}`);

        // Call ServiceC for external data
        const [weather, timezone] = await Promise.all([
            this.weather.getWeather(city),
            this.weather.getTimezone(city)
        ]);

        return {
            city,
            weather,
            timezone
        };
    }

    /**
     * Compare multiple cities.
     * Demonstrates calling ServiceC multiple times.
     */
    async compareCities(cities: string[]): Promise<CityComparison> {
        GGLog.debug(this, `Comparing cities: ${cities.join(", ")}`);

        const cityInfos = await Promise.all(
            cities.map(city => this.getCityInfo(city))
        );

        // Find warmest and coldest
        let warmest = cityInfos[0];
        let coldest = cityInfos[0];

        for (const info of cityInfos) {
            if (info.weather.temperature > warmest.weather.temperature) {
                warmest = info;
            }
            if (info.weather.temperature < coldest.weather.temperature) {
                coldest = info;
            }
        }

        return {
            cities: cityInfos,
            warmest: warmest.city,
            coldest: coldest.city
        };
    }

    /**
     * Get just the weather for a city.
     * Simple passthrough to demonstrate direct ServiceC access.
     */
    async getWeather(city: string): Promise<WeatherData> {
        return this.weather.getWeather(city);
    }
}
