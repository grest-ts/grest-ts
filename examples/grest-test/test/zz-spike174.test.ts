import {GGTest, GGTestContext} from "@grest-ts/testkit";
import {SERVER_ERROR} from "@grest-ts/schema";
import {SpikeCallerApi, SpikePinnedRuntime, SpikeTargetApi} from "../src/zzSpikePinned";

describe("spike174", () => {
    GGTest.startWorker(SpikePinnedRuntime);
    const t = new GGTestContext("T").apis({caller: SpikeCallerApi});

    test("schema mock intercepts a pinned call", async () => {
        await t.caller.trigger({msg: "hi"})
            .with(SpikeTargetApi.mock.ping.toMatchObject({msg: "hi"}).andReturn({pong: "mocked"}))
            .toEqual({pong: "mocked"});
    });

    test("unmocked pinned call still dials the pinned target", async () => {
        await t.caller.trigger({msg: "hi"}).toBeError(SERVER_ERROR);
    });
});
