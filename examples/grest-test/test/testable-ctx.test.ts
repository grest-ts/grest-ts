import {IsCountry, IsLanguage, IsLocale} from "@grest-ts/schema";
import {callOn, GGTest, GGTestContext, mockOf} from "@grest-ts/testkit";
import {ChainRuntime} from "../src/chain";
import {ChainApi, ChainApiContract} from "../src/api/ChainApi";
import {CityService, TravelPlannerService, WeatherService} from "../src/services/chain";
import {GG_INTL_LOCALE} from "@grest-ts/intl";
import {GGRuntime} from "@grest-ts/runtime";

describe("chain - comparing testing approaches", () => {

    const f = GGTest.startWorker({service: [ChainRuntime, ChainRuntime]});

    const usedApis = {
        http: {
            chain: ChainApi,
        },
        contract: {
            chain: ChainApiContract,
        },
        services: {
            weather: WeatherService,
            travel: TravelPlannerService,
            city: CityService
        }
    };

    const alice = new GGTestContext("alice")
        .apis(usedApis)
        .beforeAll(() => {
            alice.set(GG_INTL_LOCALE, {locale: IsLocale.parse("et-EE"), country: IsCountry.parse("EE"), language: IsLanguage.parse("et")})
        })

    const bob = new GGTestContext("bob")
        .apis(usedApis)
        .beforeAll(() => {
            bob.set(GG_INTL_LOCALE, {locale: IsLocale.parse("en-GB"), country: IsCountry.parse("GB"), language: IsLanguage.parse("en")})
        })

    // Test users with their expected locales
    const testUsers = [
        {name: "alice", user: alice, expectedLocale: "et-EE"},
        {name: "bob", user: bob, expectedLocale: "en-GB"},
    ];

    describe.each(testUsers)("context propagation for $name", ({user, expectedLocale}) => {

        test("via HTTP API", async () => {
            await callOn(ChainApi, user).quickWeatherCheck({city: "API Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await user.callOn(ChainApi).quickWeatherCheck({city: "API Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await user.http.chain.quickWeatherCheck({city: "API Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await f.service.callOn(ChainApi, user).quickWeatherCheck({city: "API Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});
        });

        test("via Contract", async () => {
            await callOn(ChainApiContract, user).quickWeatherCheck({city: "Contract Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await user.callOn(ChainApiContract).quickWeatherCheck({city: "Contract Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await user.contract.chain.quickWeatherCheck({city: "Contract Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await f.service.callOn(ChainApiContract, user).quickWeatherCheck({city: "Contract Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});
        });

        test("via testable() - direct service call", async () => {
            await callOn(TravelPlannerService, user).quickWeatherCheck({city: "Direct Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await user.callOn(TravelPlannerService).quickWeatherCheck({city: "Direct Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await user.services.travel.quickWeatherCheck({city: "Direct Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});

            await f.service.callOn(TravelPlannerService, user).quickWeatherCheck({city: "Direct Test"})
                .with(mockOf(WeatherService).getWeather.andReturn({temperature: 70, condition: "nice", humidity: 50}))
                .toMatchObject({suitable: true, locale: expectedLocale});
        });
    });

    test("testable() can call methods not exposed via API", async () => {
        await callOn(CityService, alice)
            .getWeather("Internal Method Test")
            .with(mockOf(WeatherService).getWeather.andReturn({temperature: 65, condition: "pleasant", humidity: 55}))
            .toMatchObject({temperature: 65, condition: "pleasant"})

        await alice.callOn(CityService)
            .getWeather("Internal Method Test")
            .with(mockOf(WeatherService).getWeather.andReturn({temperature: 65, condition: "pleasant", humidity: 55}))
            .toMatchObject({temperature: 65, condition: "pleasant"})

        await alice.services.city
            .getWeather("Internal Method Test")
            .with(mockOf(WeatherService).getWeather.andReturn({temperature: 65, condition: "pleasant", humidity: 55}))
            .toMatchObject({temperature: 65, condition: "pleasant"})

        await f.service.callOn(CityService, alice)
            .getWeather("Internal Method Test")
            .with(mockOf(WeatherService).getWeather.andReturn({temperature: 65, condition: "pleasant", humidity: 55}))
            .toMatchObject({temperature: 65, condition: "pleasant"})
    });
});

// ============================================================================
// Key routing tests - verifies callOn correctly routes to runtimes based on registered locator keys
// ============================================================================

// Test: multiple instances of same runtime class routes to first instance
describe("callOn key routing - same class multiple instances", () => {
    // Two instances of ChainRuntime - both have identical services
    // callOn should work because they're the same class (picks first)
    GGTest.startWorker({service: [ChainRuntime, ChainRuntime]});

    test("routes to first instance when same runtime class has multiple instances", async () => {
        // This should work - same class means same code, doesn't matter which handles it
        await callOn(WeatherService).getWeather("Test City")
            .toMatchObject({
                temperature: expect.any(Number),
                condition: expect.any(String)
            });
    });
});

// ============================================================================
// Key routing tests - verifies callOn correctly routes to runtimes based on registered locator keys
// ============================================================================

/**
 * Minimal runtime that only has WeatherService - used to test key conflicts
 * when the same @testable service exists in multiple different runtime classes.
 */
export class WeatherOnlyRuntime extends GGRuntime {
    public static readonly NAME = "weatherOnly";
    public static readonly SOURCE_MODULE_URL = import.meta.url;

    protected compose(): void {
        new WeatherService();
    }
}

// Test: different runtime classes with same key - use targeted callOn
describe("callOn key routing - different classes same key", () => {
    // ChainRuntime and WeatherOnlyRuntime both have WeatherService
    // Using startInline because WeatherOnlyRuntime is defined in test file
    const f = GGTest.startInline({chain: ChainRuntime, weather: WeatherOnlyRuntime});

    test("untargeted callOn throws when different runtime classes have the same key", async () => {
        // Without targeting, this is ambiguous - different runtime classes with same key
        await expect(
            callOn(WeatherService).getWeather("Test City").toMatchObject({})
        ).rejects.toThrow(/Multiple different runtimes have '@testable:WeatherService' registered/);
    });

    test("targeted callOn routes to specific runtime", async () => {
        // Explicitly target the chain runtime
        await f.chain.callOn(WeatherService).getWeather("Test City")
            .toMatchObject({
                temperature: expect.any(Number),
                condition: expect.any(String)
            });

        // Explicitly target the weather runtime
        await f.weather.callOn(WeatherService).getWeather("Test City")
            .toMatchObject({
                temperature: expect.any(Number),
                condition: expect.any(String)
            });
    });
});
