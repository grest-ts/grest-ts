import {GGContext} from "./GGContext";
import {GG_CONTEXT_STORAGE} from "./GGContextStorage";

export {GG_CONTEXT_STORAGE};

export class GGContextStore {


    public static hasContext(): boolean {
        return GG_CONTEXT_STORAGE.getStore() !== undefined;
    }

    public static getContext(): GGContext {
        const level = GG_CONTEXT_STORAGE.getStore();
        if (!level) {
            throw new Error(`No GGContextScope found! Make sure you have entered GGContext scope.`);
        }
        return level;
    }

    public static tryGetContext(): GGContext | undefined {
        return GG_CONTEXT_STORAGE.getStore();
    }

    static branch(name: string): GGContext {
        return new GGContext(name, GGContextStore.getContext());
    }

    // ----------------------------------------------------
    // Helper functions to make life easier :)
    // ----------------------------------------------------

    public static setImmediate<R>(fn: () => R): NodeJS.Immediate {
        return this.getContext().setImmediate(fn);
    }

    public static setTimeout<R>(fn: () => R, timeout: number): NodeJS.Timeout {
        return this.getContext().setTimeout(fn, timeout);
    }

    public static setInterval<R>(fn: () => R, timeout: number): NodeJS.Timeout {
        return this.getContext().setInterval(fn, timeout);
    }

}