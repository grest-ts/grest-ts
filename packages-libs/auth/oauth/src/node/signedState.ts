import {createHmac, timingSafeEqual} from "node:crypto"

// A tamper-proof, expiring value (payload.tag, base64url). Not encrypted: whoever holds it can read it.
export function signState(key: Buffer, value: unknown, ttlMs: number): string {
    const payload = Buffer.from(JSON.stringify({value, exp: Date.now() + ttlMs})).toString("base64url")
    return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`
}

export function verifyState<T>(key: Buffer, raw: string): T | undefined {
    const dot = raw.lastIndexOf(".")
    if (dot < 0) return undefined
    const payload = raw.slice(0, dot)
    const given = Buffer.from(raw.slice(dot + 1), "base64url")
    const expected = createHmac("sha256", key).update(payload).digest()
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
    const {value, exp} = JSON.parse(Buffer.from(payload, "base64url").toString()) as {value: T, exp: number}
    return exp > Date.now() ? value : undefined
}
