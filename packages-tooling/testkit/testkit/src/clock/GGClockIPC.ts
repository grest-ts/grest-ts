import {IPCClient} from "@grest-ts/ipc";
import type {GGTestRuntime} from "../GGTestRuntime";
import type {GGClockState} from "./GGDateShim";

export const GGClockIPC = {
    worker: {
        set: IPCClient.defineRequest<GGClockState, void>("clock.set"),
        fireDue: IPCClient.defineRequest<{target: number, timeoutMs: number}, void>("clock.fireDue"),
    }
}

/** The IPC timeout outlasts the runtime's own guard, so the runtime reports which timer is stuck. */
export function fireDueOn(runtime: GGTestRuntime, target: number, timeoutMs: number): Promise<void> {
    return runtime.sendCommand(GGClockIPC.worker.fireDue, {target, timeoutMs}, timeoutMs + 5_000);
}
