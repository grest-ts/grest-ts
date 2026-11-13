import type {GGTestRuntime} from "../GGTestRuntime";
import type {GGCallInterceptor} from "./GGCallInterceptor";

/**
 * The active interceptors of one kind. Exactly one handles a call: the one targeted at where the call happens,
 * else the untargeted one.
 */
export class GGInterceptorTable<I extends GGCallInterceptor> {

    private readonly byKey = new Map<string, I[]>();

    public add(interceptor: I): void {
        const key = interceptor.getKey();
        const list = this.byKey.get(key) ?? [];
        if (list.some(i => i.target === interceptor.target)) {
            throw new Error(`${interceptor.getLabel()} already has an active mock or spy. Exactly one interceptor handles a call, so a second one for the same ` +
                (interceptor.target ? "method and runtime" : "method") + " would never be called.");
        }
        list.push(interceptor);
        this.byKey.set(key, list);
    }

    public delete(interceptor: I): void {
        const key = interceptor.getKey();
        const list = (this.byKey.get(key) ?? []).filter(i => i !== interceptor);
        if (list.length) {
            this.byKey.set(key, list);
        } else {
            this.byKey.delete(key);
        }
    }

    public get(key: string): readonly I[] {
        return this.byKey.get(key) ?? [];
    }

    /**
     * `at` is the runtime the call happens at, when that is known and a test runtime. With `where` (the place's name
     * in failure messages) the interceptors that didn't get the call note where it went.
     */
    public match(key: string, at: GGTestRuntime | undefined, where?: string): I | undefined {
        const list = this.get(key);
        const matched = (at && list.find(i => i.target === at)) ?? list.find(i => !i.target);
        if (where !== undefined) {
            for (const other of list) {
                if (other !== matched) other.wentElsewhere(where);
            }
        }
        return matched;
    }

    public some(predicate: (interceptor: I) => boolean): boolean {
        for (const list of this.byKey.values()) {
            if (list.some(predicate)) return true;
        }
        return false;
    }

    public clear(): void {
        this.byKey.clear();
    }
}
