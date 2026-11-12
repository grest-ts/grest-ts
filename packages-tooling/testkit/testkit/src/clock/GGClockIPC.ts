import {IPCClient} from "@grest-ts/ipc";
import type {GGClockState} from "./GGDateShim";

export const GGClockIPC = {
    worker: {
        set: IPCClient.defineRequest<GGClockState, void>("clock.set"),
        fireDue: IPCClient.defineRequest<{target: number, timeoutMs: number}, void>("clock.fireDue"),
    }
}
