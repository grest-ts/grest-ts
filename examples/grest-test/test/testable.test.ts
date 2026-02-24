/**
 * Chain Test - Demonstrating @testable Direct Service Invocation
 *
 * This test file demonstrates the power of @testable decorator for testing
 * services at any level of a composed dependency chain.
 *
 * Service Chain: ServiceA -> ServiceB -> ServiceC
 *
 * Key patterns demonstrated:
 * 1. Full runtime integration testing via HTTP API
 * 2. Per-request mocking at any level (A, B, or C) using mockBy()
 * 3. Direct service invocation via testable() - THE KEY FEATURE
 * 4. Mixing direct invocation with mocking
 * 5. Spy mode for validation without mocking
 */

import {callOn, GGTest, mockOf, spyOn} from "@grest-ts/testkit";
import {ChainRuntime} from "../src/chain";
import {ChainApi} from "../src/api/ChainApi";
import {TravelPlannerService} from "../src/services/chain/TravelPlannerService";
import {CityService} from "../src/services/chain/CityService";
import {WeatherService} from "../src/services/chain/WeatherService";

// ============================================================================
// SECTION 1: Full Runtime Integration Testing
// ============================================================================

describe("testable tests - full runtime integration", () => {

    GGTest.startWorker(ChainRuntime);
    const client = callOn(ChainApi);

    test("full chain works end-to-end without mocking", async () => {
        const result = await client.planTravel({destination: "Miami"});

        expect(result.destination.city).toBe("Miami");
        expect(result.destination.weather.temperature).toBe(72);
        expect(result.recommendation).toContain("sightseeing");
    });

    test("mock ServiceC (deepest level) - real A and B logic runs", async () => {
        // Mock the external API (ServiceC) while real ServiceA and ServiceB logic runs
        await client
            .planTravel({destination: "Alaska"})
            .with(
                mockOf(WeatherService).getWeather
                    .toEqual({city: "Alaska"})
                    .andReturn({temperature: 20, condition: "snowy", humidity: 80})
            )
            .with(
                mockOf(WeatherService).getTimezone
                    .toEqual({city: "Alaska"})
                    .andReturn({timezone: "America/Anchorage", offset: -9})
            )
            .toMatchObject({
                destination: {
                    city: "Alaska",
                    weather: {temperature: 20, condition: "snowy"}
                },
                recommendation: "Cold weather - pack warm layers!"
            });
    });

    test("mock ServiceB - ServiceC never gets called", async () => {
        // Mock at ServiceB level - ServiceC is completely bypassed
        await client
            .planTravel({destination: "Paris"})
            .with(
                mockOf(CityService).getCityInfo
                    .toEqual({city: "Paris"})
                    .andReturn({
                        city: "Paris",
                        weather: {temperature: 55, condition: "cloudy", humidity: 70},
                        timezone: {timezone: "Europe/Paris", offset: 1}
                    })
            )
            .toMatchObject({
                destination: {city: "Paris"},
                recommendation: "Mild weather - bring a light jacket.",
                packingList: expect.arrayContaining(["Umbrella", "Rain jacket"])
            });
    });

    test("spy on ServiceC to verify real behavior", async () => {
        // Spy mode: calls through to real implementation but validates input/output
        await client
            .planTravel({destination: "NYC"})
            .with(
                spyOn(WeatherService).getWeather
                    .toEqual({city: "NYC"})
                    .responseToMatchObject({condition: "sunny"})
            );
    });

    test("compare destinations with mocking at ServiceB level", async () => {
        // Mock at ServiceB level for cleaner test - ServiceB.compareCities returns controlled data
        await client
            .compareDestinations({destinations: ["Hot City", "Cold City"]})
            .with(
                mockOf(CityService).compareCities
                    .andReturn({
                        cities: [
                            {city: "Hot City", weather: {temperature: 95, condition: "sunny", humidity: 30}, timezone: {timezone: "UTC", offset: 0}},
                            {city: "Cold City", weather: {temperature: 35, condition: "cloudy", humidity: 60}, timezone: {timezone: "UTC", offset: 0}}
                        ],
                        warmest: "Hot City",
                        coldest: "Cold City"
                    })
            )
            .toMatchObject({
                recommended: "Hot City",
                reason: expect.stringContaining("95")
            });
    });
});

// ============================================================================
// SECTION 2: Direct Service Invocation via testable() - THE KEY FEATURE
// ============================================================================

describe("chain - testable() direct service invocation", () => {

    GGTest.startWorker(ChainRuntime);

    /**
     * KEY FEATURE: testable(ServiceC) invokes methods directly on the service
     * instance running in the runtime, without going through HTTP.
     */
    test("testable(ServiceC) - invoke deepest service directly", async () => {
        const weather = await callOn(WeatherService).getWeather("Boston");

        expect(weather.temperature).toBe(72);
        expect(weather.condition).toBe("sunny");
    });

    /**
     * KEY FEATURE: testable(ServiceB) invokes ServiceB directly.
     * ServiceB's dependency (ServiceC) is automatically available because
     * it was wired during compose().
     */
    test("testable(ServiceB) - invoke middle service, ServiceC auto-wired", async () => {
        // When we call ServiceB directly, it uses the real ServiceC
        // that was injected during runtime composition
        const cityInfo = await callOn(CityService).getCityInfo("Seattle");

        expect(cityInfo.city).toBe("Seattle");
        expect(cityInfo.weather.temperature).toBe(72); // From real ServiceC
        expect(cityInfo.timezone.timezone).toBe("America/New_York"); // From real ServiceC
    });

    /**
     * KEY FEATURE: testable(ServiceA) with full chain auto-wired
     */
    test("testable(ServiceA) - invoke top service, full chain auto-wired", async () => {
        const plan = await callOn(TravelPlannerService).planTravel({destination: "Denver"});

        expect(plan.destination.city).toBe("Denver");
        expect(plan.recommendation).toContain("sightseeing"); // Based on 72°F
        expect(plan.packingList).toContain("Passport");
    });

    /**
     * testable() works with response expectations just like HTTP calls
     */
    test("testable() with response expectations", async () => {
        await callOn(WeatherService)
            .getWeather("Chicago")
            .toMatchObject({
                temperature: 72,
                condition: "sunny"
            });
    });

    /**
     * testable() with toEqual for exact matching
     */
    test("testable() with toEqual expectation", async () => {
        await callOn(WeatherService)
            .getTimezone("Portland")
            .toEqual({
                timezone: "America/New_York",
                offset: -5
            });
    });
});

// ============================================================================
// SECTION 3: testable() Combined with mockBy() - Maximum Power
// ============================================================================

describe("chain - testable() with mocking", () => {

    GGTest.startWorker(ChainRuntime);

    /**
     * THE MOST POWERFUL PATTERN: Call ServiceB directly while mocking ServiceC.
     * This tests ServiceB's logic in isolation without setting up complex mocks.
     */
    test("testable(ServiceB) with mockBy(ServiceC) - test B logic with controlled C", async () => {
        await callOn(CityService)
            .getCityInfo("Arctic Base")
            .with(
                mockOf(WeatherService).getWeather
                    .toEqual({city: "Arctic Base"})
                    .andReturn({temperature: -40, condition: "blizzard", humidity: 90}),
                mockOf(WeatherService).getTimezone
                    .toEqual({city: "Arctic Base"})
                    .andReturn({timezone: "Arctic/Base", offset: 0})
            )
            .toMatchObject({
                city: "Arctic Base",
                weather: {temperature: -40, condition: "blizzard"}
            });
    });

    /**
     * Call ServiceA directly while mocking ServiceB - tests A's logic only
     */
    test("testable(ServiceA) with mockBy(ServiceB) - test A logic with controlled B", async () => {
        await callOn(TravelPlannerService)
            .planTravel({destination: "Test City"})
            .with(
                mockOf(CityService).getCityInfo
                    .toEqual({city: "Test City"})
                    .andReturn({
                        city: "Test City",
                        weather: {temperature: 100, condition: "scorching", humidity: 10},
                        timezone: {timezone: "Test/Zone", offset: 0}
                    })
            )
            .toMatchObject({
                destination: {city: "Test City"},
                recommendation: "Hot weather! Stay hydrated and use sunscreen.",
                packingList: expect.arrayContaining(["Sunscreen", "Sunglasses"])
            });
    });

    /**
     * Call ServiceA directly while mocking at ServiceC level (skip B's mock)
     */
    test("testable(ServiceA) with mockBy(ServiceC) - test A+B logic together", async () => {
        await callOn(TravelPlannerService)
            .quickWeatherCheck({city: "Tropical Island"})
            .with(
                mockOf(WeatherService).getWeather
                    .toEqual({city: "Tropical Island"})
                    .andReturn({temperature: 85, condition: "sunny", humidity: 80})
            )
            .toMatchObject({
                city: "Tropical Island",
                suitable: true,
                reason: "Perfect weather for travel!"
            });
    });

    /**
     * Compare cities - testing testable() with ServiceB method that has complex return type.
     * Uses real ServiceC (via auto-wiring) for simplicity.
     */
    test("testable(ServiceB).compareCities with real ServiceC", async () => {
        // This test verifies testable() works with methods that return complex structures.
        // ServiceC returns 72°F for all cities, so warmest/coldest will be the first/last alphabetically
        // since temperatures are equal.
        const result = await callOn(CityService).compareCities(["Boston", "Chicago"]);

        expect(result.cities).toHaveLength(2);
        expect(result.cities[0].city).toBe("Boston");
        expect(result.cities[1].city).toBe("Chicago");
        // Both cities have same temperature (72) from real ServiceC
        expect(result.cities[0].weather.temperature).toBe(72);
        expect(result.cities[1].weather.temperature).toBe(72);
    });
});

// ============================================================================
// SECTION 4: Testing Edge Cases and Error Conditions
// ============================================================================

describe("chain - edge cases", () => {

    GGTest.startWorker(ChainRuntime);

    test("testable() with array results and arrayToContain", async () => {
        await callOn(TravelPlannerService)
            .planTravel({destination: "Warm Place"})
            .with(
                mockOf(WeatherService).getWeather
                    .andReturn({temperature: 85, condition: "sunny", humidity: 40})
            )
            .with(
                mockOf(WeatherService).getTimezone
                    .andReturn({timezone: "UTC", offset: 0})
            )
            .toMatchObject({
                packingList: expect.arrayContaining(["Sunscreen", "Light clothing"])
            });
    });

    test("weather check at temperature boundary (60°F)", async () => {
        await callOn(TravelPlannerService)
            .quickWeatherCheck({city: "Boundary City"})
            .with(
                mockOf(WeatherService).getWeather
                    .andReturn({temperature: 60, condition: "mild", humidity: 50})
            )
            .toMatchObject({
                suitable: true,
                reason: "Perfect weather for travel!"
            });
    });

    test("weather check below boundary (59°F)", async () => {
        await callOn(TravelPlannerService)
            .quickWeatherCheck({city: "Cold Boundary"})
            .with(
                mockOf(WeatherService).getWeather
                    .andReturn({temperature: 59, condition: "chilly", humidity: 50})
            )
            .toMatchObject({
                suitable: false,
                reason: "Too cold - pack warm clothes"
            });
    });

    test("weather check above boundary (86°F)", async () => {
        await callOn(TravelPlannerService)
            .quickWeatherCheck({city: "Hot Boundary"})
            .with(
                mockOf(WeatherService).getWeather
                    .andReturn({temperature: 86, condition: "hot", humidity: 50})
            )
            .toMatchObject({
                suitable: false,
                reason: "Too hot - stay hydrated"
            });
    });
});

// ============================================================================
// SECTION 5: Comparison - API vs testable() approaches
// ============================================================================

describe("chain - comparing testing approaches", () => {

    GGTest.startWorker(ChainRuntime);
    const client = callOn(ChainApi);

    /**
     * Via HTTP API - tests the full stack including HTTP layer
     */
    test("via HTTP API - full integration", async () => {
        await client
            .quickWeatherCheck({city: "API Test"})
            .with(
                mockOf(WeatherService).getWeather
                    .andReturn({temperature: 70, condition: "nice", humidity: 50})
            )
            .toMatchObject({suitable: true});
    });

    /**
     * Via testable() - bypasses HTTP, tests service logic directly
     *
     * Benefits:
     * - Faster execution (no HTTP overhead)
     * - Easier to test internal service methods not exposed via API
     * - Same mocking capabilities
     * - Same expectation syntax
     */
    test("via testable() - direct service call", async () => {
        await callOn(TravelPlannerService)
            .quickWeatherCheck({city: "Direct Test"})
            .with(
                mockOf(WeatherService).getWeather
                    .andReturn({temperature: 70, condition: "nice", humidity: 50})
            )
            .toMatchObject({suitable: true});
    });

    /**
     * testable() can call ANY method, not just API-exposed ones
     */
    test("testable() can call methods not exposed via API", async () => {
        // ServiceB.getWeather is not in the HTTP API, but we can still test it
        await callOn(CityService)
            .getWeather("Internal Method Test")
            .with(
                mockOf(WeatherService).getWeather
                    .andReturn({temperature: 65, condition: "pleasant", humidity: 55})
            )
            .toMatchObject({
                temperature: 65,
                condition: "pleasant"
            });
    });
});
