import {IPCClient} from "@grest-ts/ipc";
import type {GGTestRuntime} from "../GGTestRuntime";
import {GGClockState, GGDateShim} from "./GGDateShim";

export const GGClockIPC = {
    worker: {
        set: IPCClient.defineRequest<GGClockState, void>("clock.set"),
        reset: IPCClient.defineRequest<void, void>("clock.reset"),
    }
}

export function sendClock(runtime: GGTestRuntime, state: GGClockState): Promise<void> {
    return GGDateShim.isDefault(state)
        ? runtime.sendCommand(GGClockIPC.worker.reset, undefined)
        : runtime.sendCommand(GGClockIPC.worker.set, state);
}
