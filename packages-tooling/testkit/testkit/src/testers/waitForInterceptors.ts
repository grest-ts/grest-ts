import {IGGTestInterceptor} from "./IGGTestInterceptor";

export const DEFAULT_WAIT_FOR_MS = 5000;

const CHECK_INTERVAL_MS = 20;

export interface GGPendingWait {
    interceptor: IGGTestInterceptor;
    timeout: number;
}

/**
 * Polls until every interceptor is satisfied. Each one is released as soon as it is, so a message that repeats
 * (a periodic push) can't reach a listener that already got what it waited for. On a timeout the error carries
 * what the interceptor saw instead.
 */
export async function waitForInterceptors(waits: GGPendingWait[], release: (interceptor: IGGTestInterceptor) => Promise<void>): Promise<void> {
    const start = Date.now();
    const pending = new Set(waits);
    while (pending.size) {
        for (const wait of pending) {
            if (wait.interceptor.isCalled()) {
                pending.delete(wait);
                await release(wait.interceptor);
            } else if (Date.now() - start > wait.timeout) {
                throw await timeoutError(wait);
            }
        }
        if (pending.size) await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
    }
}

async function timeoutError({interceptor, timeout}: GGPendingWait): Promise<Error> {
    let detail: unknown;
    try {
        await interceptor.validate();
        detail = interceptor.getMockValidationError();
    } catch (error) {
        detail = error;
    }
    const message = detail instanceof Error ? detail.message : "The expectation was not met.";
    return new Error(`[Test Failed] Not satisfied within ${timeout}ms (set it with .within(ms) or .waitFor(x, ms))\n${message}`);
}
