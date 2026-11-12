import {GGTest, GGTestContext, mockOf} from "@grest-ts/testkit";
import {ChainRuntime} from "../src/chain";
import {ChainApi} from "../src/api/ChainApi";
import {WeatherService} from "../src/services/chain/WeatherService";

describe("spike172", () => {
    GGTest.startWorker(ChainRuntime);
    const bob = new GGTestContext("Bob").apis({chain: ChainApi});

    test("test client inside mock callback", async () => {
        let n = 0;
        await bob.chain.planTravel({destination: "Alaska"})
            .with(mockOf(WeatherService).getWeather.times(2).andReturn(async () => {
                if (++n > 1) return {temperature: 1, condition: "inner", humidity: 1};
                const r = await bob.chain.quickWeatherCheck({city: "Paris"});
                return {temperature: 20, condition: r.city, humidity: 1};
            }))
            .toMatchObject({destination: {weather: {condition: "Paris"}}});
    });
});
