import {enumOf, type Values} from "@grest-ts/common";

/**
 * Wire-log verbosity for the WebSocket client. Integer-backed; OFF is `0`
 * so the fast-path gate is a single truthy check (`if (logMode) emit(...)`).
 *
 * Set per-client via `Api.createClient({logMode: GGWsLogMode.NON_OK})`. The
 * mode is static for the client's lifetime — wire-log noise level is a
 * deployment decision, not a per-request one.
 *
 *   OFF     — silent (fast path: no entry construction)
 *   NON_OK  — only sketchy outcomes (rejected calls, validation errors,
 *             unexpected drops, retries exhausted)
 *   ALL     — every frame + every lifecycle transition logged
 */
export const GGWsLogMode = enumOf({
    OFF: 0,
    NON_OK: 1,
    ALL: 2,
});
export type GGWsLogMode = Values<typeof GGWsLogMode>;
