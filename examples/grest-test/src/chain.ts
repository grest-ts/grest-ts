/**
 * ChainRuntime - Runtime for demonstrating @testable direct service invocation.
 *
 * This runtime sets up the service chain: ServiceA -> ServiceB -> ServiceC
 * All services are decorated with @testable and @mockable.
 *
 * Tests can:
 * 1. Call the full HTTP API with mocks at any level
 * 2. Call ServiceB directly via testable(ServiceB), with ServiceC available
 * 3. Call ServiceC directly via testable(ServiceC)
 * 4. Mock ServiceC when testing ServiceB
 * 5. Mock ServiceB when testing ServiceA
 */

import {GGRuntime} from "@grest-ts/runtime";
import {GGHttp, GGHttpServer} from "@grest-ts/http";
import {GGMetricsLoader} from "@grest-ts/metrics";

import {ChainApi} from "./api/ChainApi";
import {TravelPlannerService} from "./services/chain/TravelPlannerService";
import {CityService} from "./services/chain/CityService";
import {WeatherService} from "./services/chain/WeatherService";

export class ChainRuntime extends GGRuntime {

    public static readonly NAME = "chain";

    protected compose(): void {

        new GGMetricsLoader();

        // Build the service chain: C -> B -> A
        // Each service gets @testable registration automatically via decorator
        const serviceC = new WeatherService();
        const serviceB = new CityService(serviceC);
        const serviceA = new TravelPlannerService(serviceB);

        new GGHttp(new GGHttpServer())
            .http(ChainApi, serviceA);
    }
}

ChainRuntime.cli(import.meta.url).then();
