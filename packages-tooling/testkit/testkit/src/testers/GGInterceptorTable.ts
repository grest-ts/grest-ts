import {GGInterceptorTarget, GGTestTarget} from "./GGTestTarget";
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
        if (list.some(i => sameTarget(i.target, interceptor.target))) {
            throw new Error(`${interceptor.getLabel()} already has an active mock or spy. Exactly one interceptor handles a call, so a second one for the same ` +
                (interceptor.target ? "method and target" : "method") + " would never be called.");
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
     * `isAt` says whether the call happens at a target; leave it out when where the call happens is unknown. With
     * `where` (the place's name in failure messages) the interceptors that didn't get the call note where it went.
     */
    public match(key: string, isAt: ((target: GGInterceptorTarget) => boolean) | undefined, where?: string): I | undefined {
        const list = this.get(key);
        const matched = (isAt && list.find(i => i.target && isAt(i.target))) ?? list.find(i => !i.target);
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

function sameTarget(a: GGInterceptorTarget | undefined, b: GGInterceptorTarget | undefined): boolean {
    return a === b || (a instanceof GGTestTarget && b instanceof GGTestTarget && a.host === b.host && a.port === b.port);
}
