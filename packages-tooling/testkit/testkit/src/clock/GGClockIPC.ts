import {IPCClient} from "@grest-ts/ipc";
import type {GGClockState} from "./GGDateShim";

export const GGClockIPC = {
    worker: {
        set: IPCClient.defineRequest<GGClockState, void>("clock.set"),
        reset: IPCClient.defineRequest<void, void>("clock.reset"),
        fireDue: IPCClient.defineRequest<{timeoutMs: number}, void>("clock.fireDue"),
    }
}
