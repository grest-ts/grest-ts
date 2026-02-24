import {GG_TEST_RUNNER} from "@grest-ts/testkit";
import {GGLocalDiscoveryServer, RoutingStrategy, RoutingStrategyName} from "@grest-ts/discovery-local";

export class GGLocalRoutingStrategySelector {

    private readonly apiName: string

    constructor(apiName: string) {
        this.apiName = apiName;
    }

    public first(): void {
        this._set('first');
    }

    public last(): void {
        this._set('last');
    }

    public random(): void {
        this._set('random');
    }

    public roundRobin(): void {
        this._set('roundRobin');
    }

    public set(strategy: RoutingStrategyName | RoutingStrategy): void {
        this._set(strategy)
    }

    // --------------------------------------

    private _set(strategy: RoutingStrategyName | RoutingStrategy): void {
        const server = GG_TEST_RUNNER.get().discoveryServer as GGLocalDiscoveryServer;
        server.setRoutingStrategy(this.apiName, strategy);
    }

}
