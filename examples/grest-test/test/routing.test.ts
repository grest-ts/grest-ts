import {callOn, GGTest} from "@grest-ts/testkit";
import {RoutingStrategy} from "@grest-ts/discovery-local";
import {MainRuntime} from "../src/main";
import {ConfigTestApi} from "../src/api/ConfigTestApi";
import {SERVER_ERROR} from "@grest-ts/schema";

class NoRouteStrategy implements RoutingStrategy {
    select() {
        return undefined as any;
    }
}

describe.shuffle("routing", () => {

    const t = GGTest.startInline([MainRuntime, MainRuntime]);
    const client = callOn(ConfigTestApi);

    afterEach(async () => {
        // Reset to default
        ConfigTestApi.routing.last();
    });

    test("first() routes to first instance", async () => {
        ConfigTestApi.routing.first();

        const cursor = await t[0].logs.cursor();
        await client.logMessage({message: "first test"});

        const logs = await cursor.retrieve();
        expect(logs.some(l => l.message?.includes("Log message: first test"))).toBe(true);
    });

    test("last() routes to last instance", async () => {
        ConfigTestApi.routing.last();

        const cursor = await t[1].logs.cursor();
        await client.logMessage({message: "last test"});

        const logs = await cursor.retrieve();
        expect(logs.some(l => l.message?.includes("Log message: last test"))).toBe(true);
    });

    test("roundRobin() alternates between instances", async () => {
        ConfigTestApi.routing.roundRobin();

        const cursor0 = await t[0].logs.cursor();
        const cursor1 = await t[1].logs.cursor();

        await client.logMessage({message: "rr1"});
        await client.logMessage({message: "rr2"});

        const logs0 = await cursor0.retrieve();
        const logs1 = await cursor1.retrieve();

        // Each instance should have handled one request
        const rr1_in_0 = logs0.some(l => l.message?.includes("rr1"));
        const rr2_in_0 = logs0.some(l => l.message?.includes("rr2"));
        const rr1_in_1 = logs1.some(l => l.message?.includes("rr1"));
        const rr2_in_1 = logs1.some(l => l.message?.includes("rr2"));

        // Requests should be distributed (not both in same instance)
        expect(rr1_in_0 !== rr1_in_1).toBe(true);
        expect(rr2_in_0 !== rr2_in_1).toBe(true);
    });

    test("custom strategy that returns undefined fails request", async () => {
        ConfigTestApi.routing.set(new NoRouteStrategy());
        await client.logMessage({message: "should fail"}).toBeError(SERVER_ERROR);
    });
});
