/** Console wire-log used by the websocket clients. Internal — not part of the package surface. */
export const log = {
    info: (name: string, msg: string, data?: unknown) => console.info(`[${name}]`, msg, data),
    warn: (name: string, msg: string, data?: unknown) => console.warn(`[${name}]`, msg, data),
    error: (name: string, msg: string, errorOrData?: unknown, data?: unknown) =>
        console.error(`[${name}]`, msg, errorOrData, data),
}
