import {GGLocatorScope, hasLiveTimerOwner} from "./GGLocatorScope";
import {GG_ASYNC_STORAGE} from "./GGLocatorStorage";

export class GGLocator {

    public static hasScope(): boolean {
        return GG_ASYNC_STORAGE.getStore() !== undefined;
    }

    public static getScope(): GGLocatorScope {
        const level = GG_ASYNC_STORAGE.getStore();
        if (!level) {
            throw new Error(`No GGLocatorScope found! Make sure you have entered GGLocatorScope context.`);
        }
        return level;
    }

    public static tryGetScope(): GGLocatorScope | undefined {
        return GG_ASYNC_STORAGE.getStore();
    }

    // ----------------------------------------------------
    // Helper functions to make life easier :)
    // ----------------------------------------------------

    public static wrapWithRun<T extends (...args: any[]) => any>(fn: T): T {
        return this.getScope().wrapWithRun(fn);
    }

    public static wrapWithEnter<T extends (...args: any[]) => any>(fn: T): T {
        return this.getScope().wrapWithEnter(fn);
    }

    public static setImmediate<R>(fn: () => R): NodeJS.Immediate {
        return this.getScope().setImmediate(fn);
    }

    /**
     * Outside a scope (a CLI, a plain unit test) this is a plain `setTimeout`. Outside a scope while a runtime runs in
     * the process, it warns: such a timer is neither cleared with the runtime nor moved by the test clock.
     */
    public static setTimeout<R>(fn: () => R, timeout: number): NodeJS.Timeout {
        const scope = this.tryGetScope();
        if (scope) return scope.setTimeout(fn, timeout);
        warnOutsideScope("setTimeout");
        return setTimeout(fn, timeout);
    }

    /** As `setTimeout`, for `setInterval`. */
    public static setInterval<R>(fn: () => R, timeout: number): NodeJS.Timeout {
        const scope = this.tryGetScope();
        if (scope) return scope.setInterval(fn, timeout);
        warnOutsideScope("setInterval");
        return setInterval(fn, timeout);
    }

}
const warnedSites = new Set<string>();

function warnOutsideScope(fn: string): void {
    if (!hasLiveTimerOwner()) return;
    const site = new Error().stack?.split("\n")[3]?.trim() ?? "";
    if (warnedSites.has(site)) return;
    warnedSites.add(site);
    console.warn(`GGLocator.${fn} was called outside a GGLocatorScope while a runtime runs: it's a plain timer that the runtime won't clear and the test clock won't move. Call it from code that runs in the runtime's scope. Set at: ${site}`);
}
