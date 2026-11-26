/** Sends one ping and resolves whether any inbound frame (its pong or other traffic) arrived within `timeoutMs`. */
export function probeLink(opts: {sendPing: () => void, lastActivityAt: () => number, timeoutMs: number}): Promise<boolean> {
    const sentAt = performance.now();
    try {
        opts.sendPing();
    } catch (_) {
        return Promise.resolve(false);
    }
    return new Promise(resolve => setTimeout(() => resolve(opts.lastActivityAt() >= sentAt), opts.timeoutMs));
}
