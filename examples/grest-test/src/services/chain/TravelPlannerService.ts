/**
 * ServiceA - Top-level service in the chain (exposed via HTTP API).
 *
 * Depends on ServiceB for city information.
 * Demonstrates:
 * - Full dependency chain: ServiceA -> ServiceB -> ServiceC
 * - Business logic using data from lower services
 * - @testable and @mockable decorators
 */

import {testable, mockable} from "@grest-ts/testkit-runtime";
import {GGLog} from "@grest-ts/logger";
import {CityService, CityInfo} from "./CityService";
import {GG_INTL_LOCALE} from "@grest-ts/intl";

export interface TravelPlan {
    destination: CityInfo;
    recommendation: string;
    packingList: string[];
}

export interface TravelComparison {
    cities: CityInfo[];
    recommended: string;
    reason: string;
}

@testable
@mockable
export class TravelPlannerService {

    constructor(private readonly cityService: CityService) {
    }

    /**
     * Plan a trip to a destination.
     * Uses ServiceB to get city info, then adds recommendations.
     */
    async planTravel(input: { destination: string }): Promise<TravelPlan> {
        const {destination} = input;
        GGLog.debug(this, `Planning travel to ${destination}`);

        const cityInfo = await this.cityService.getCityInfo(destination);

        const recommendation = this.generateRecommendation(cityInfo);
        const packingList = this.generatePackingList(cityInfo);

        return {
            destination: cityInfo,
            recommendation,
            packingList
        };
    }

    /**
     * Compare multiple destinations and recommend the best one.
     */
    async compareDestinations(input: { destinations: string[] }): Promise<TravelComparison> {
        const {destinations} = input;
        GGLog.debug(this, `Comparing destinations: ${destinations.join(", ")}`);

        const comparison = await this.cityService.compareCities(destinations);

        // Recommend based on weather
        const recommended = comparison.warmest;
        const reason = `${recommended} has the warmest weather at ${
            comparison.cities.find(c => c.city === recommended)?.weather.temperature
        }°F`;

        return {
            cities: comparison.cities,
            recommended,
            reason
        };
    }

    /**
     * Get a quick weather check for trip planning.
     */
    async quickWeatherCheck(input: { city: string }): Promise<{ city: string; suitable: boolean; reason: string; locale?: string }> {
        const {city} = input;
        const weather = await this.cityService.getWeather(city);

        const suitable = weather.temperature >= 60 && weather.temperature <= 85;
        const reason = suitable
            ? "Perfect weather for travel!"
            : weather.temperature < 60
                ? "Too cold - pack warm clothes"
                : "Too hot - stay hydrated";

        const locale = GG_INTL_LOCALE.get()?.locale;

        return {city, suitable, reason, locale};
    }

    private generateRecommendation(cityInfo: CityInfo): string {
        const temp = cityInfo.weather.temperature;

        if (temp > 80) {
            return "Hot weather! Stay hydrated and use sunscreen.";
        } else if (temp > 65) {
            return "Perfect weather for sightseeing!";
        } else if (temp > 50) {
            return "Mild weather - bring a light jacket.";
        } else {
            return "Cold weather - pack warm layers!";
        }
    }

    private generatePackingList(cityInfo: CityInfo): string[] {
        const temp = cityInfo.weather.temperature;
        const condition = cityInfo.weather.condition;

        const list: string[] = ["Passport", "Phone charger", "Toiletries"];

        if (temp > 75) {
            list.push("Sunscreen", "Sunglasses", "Light clothing");
        } else if (temp > 55) {
            list.push("Light jacket", "Comfortable walking shoes");
        } else {
            list.push("Warm coat", "Sweater", "Warm socks");
        }

        if (condition === "rainy" || condition === "cloudy") {
            list.push("Umbrella", "Rain jacket");
        }

        return list;
    }
}
