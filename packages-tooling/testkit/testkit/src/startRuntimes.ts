import type {GGTestRuntime} from "./GGTestRuntime";

// Together, because a runtime's boot is loading its own module graph; a runtime must not call a peer from its start().
// Every start settles before this fails, so teardown never races a runtime that is still booting.
export async function startRuntimes(runtimes: readonly GGTestRuntime[]): Promise<void> {
    const results = await Promise.allSettled(runtimes.map(runtime => runtime.start()));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
}
