/**
 * Framework-reserved keepalive frames for raw byte-stream sockets (GGRawSocket).
 *
 * A browser can't send a protocol WS ping (the native API hides ping/pong), so a raw stream
 * needs an in-band frame to probe a half-open link. Unlike the typed GGSocket — which has a
 * dedicated control-frame channel — a raw socket's payload is opaque, so these sentinels ride
 * the wire as ordinary text frames. They are NUL-wrapped to make collision with real app text
 * (JSON control, log lines) effectively impossible, and GGRawSocket filters them out of BOTH
 * directions so the application never sees them. This mirrors GGSocket's transparent PING->PONG
 * (see SocketMessage.MessageType) — the raw equivalent, owned entirely by the framework.
 */
const NUL = String.fromCharCode(0);
export const RAW_PING = NUL + "gg-raw-ping" + NUL;
export const RAW_PONG = NUL + "gg-raw-pong" + NUL;

// Both sentinels are single-byte chars of equal length, so one length gate filters candidates
// without decoding ordinary (often large) text frames.
const SENTINEL_LEN = RAW_PING.length;

/** Classify a text frame as a keepalive sentinel, decoding only same-length candidates. */
export function rawKeepaliveKind(data: Uint8Array, isBinary: boolean): "ping" | "pong" | undefined {
    if (isBinary || data.length !== SENTINEL_LEN) return undefined;
    const text = new TextDecoder().decode(data);
    if (text === RAW_PING) return "ping";
    if (text === RAW_PONG) return "pong";
    return undefined;
}
