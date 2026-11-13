import {GGLocatorScope} from "./GGLocatorScope";
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

    /** Outside a scope (a CLI, a plain unit test) this is a plain `setTimeout`. */
    public static setTimeout<R>(fn: () => R, timeout: number): NodeJS.Timeout {
        return this.tryGetScope()?.setTimeout(fn, timeout) ?? setTimeout(fn, timeout);
    }

    /** Outside a scope (a CLI, a plain unit test) this is a plain `setInterval`. */
    public static setInterval<R>(fn: () => R, timeout: number): NodeJS.Timeout {
        return this.tryGetScope()?.setInterval(fn, timeout) ?? setInterval(fn, timeout);
    }

}