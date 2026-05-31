import {describe, it, expect, vi, beforeEach} from 'vitest'
import {GGContext, GGContextKey} from '@grest-ts/context'
import {GGContextKeySynchronizer} from '@grest-ts/http'
import {GGSocketPool} from '@grest-ts/websocket'
import {IsString} from '@grest-ts/schema'

const WS_TOKEN = new GGContextKey<string | undefined>('ws-gate-test:token', IsString.orUndefined)

const DELIM = ':'
const HANDSHAKE = 'h'
const HANDSHAKE_OK = 'k'

function frame(type: string, path: string, id: string, data: unknown): string {
    return `${type}${DELIM}${path}${DELIM}${id}${DELIM}${data !== undefined ? JSON.stringify(data) : ''}`
}

function parseHandshakeHeaders(raw: string): Record<string, string> {
    const parts = raw.split(DELIM)
    const dataStr = parts.length > 3 ? parts.slice(3).join(DELIM) : ''
    if (!dataStr) return {}
    try { return JSON.parse(dataStr) } catch { return {} }
}

function inContext<T>(fn: () => Promise<T>): Promise<T> {
    return new GGContext('ws-gate-test').run(fn)
}

class FakeAdapter {
    private openHandlers: Array<() => void> = []
    private messageHandlers: Array<(data: string) => void> = []
    private closeHandlers: Array<() => void> = []
    private errorHandlers: Array<(e: Error) => void> = []

    public sent: string[] = []

    send(message: string): void {
        this.sent.push(message)
        if (message.startsWith(HANDSHAKE + DELIM)) {
            const ack = frame(HANDSHAKE_OK, '', '', undefined)
            // Deliver ACK in the next microtask so that the onMessage handler
            // registered immediately after adapter.send() is already in place.
            Promise.resolve().then(() => {
                for (const h of this.messageHandlers) h(ack)
            })
        }
    }

    close(): void { for (const h of this.closeHandlers) h() }

    onOpen(handler: () => void): void { this.openHandlers.push(handler) }
    onMessage(handler: (data: string) => void): void { this.messageHandlers.push(handler) }
    onClose(handler: () => void): void { this.closeHandlers.push(handler) }
    onError(handler: (e: Error) => void): void { this.errorHandlers.push(handler) }
    offOpen(handler: () => void): void { this.openHandlers = this.openHandlers.filter(h => h !== handler) }
    offMessage(handler: (data: string) => void): void { this.messageHandlers = this.messageHandlers.filter(h => h !== handler) }
    offClose(handler: () => void): void { this.closeHandlers = this.closeHandlers.filter(h => h !== handler) }
    offError(handler: (e: Error) => void): void { this.errorHandlers = this.errorHandlers.filter(h => h !== handler) }

    triggerOpen(): void { for (const h of this.openHandlers) h() }
}

let fakeAdapter: FakeAdapter

beforeEach(() => {
    GGSocketPool.__clearForTesting()
    fakeAdapter = new FakeAdapter()
    GGSocketPool.setAdapter(class {
        constructor() { return fakeAdapter as any }
    } as any)
})

async function connectAndGetHandshakeHeaders(
    config: Parameters<typeof GGSocketPool.connect>[0]
): Promise<Record<string, string>> {
    const connectPromise = GGSocketPool.connect(config)
    // Yield to the microtask queue so openSocket's internal await resolves and
    // the onOpen handler gets registered before we fire the open event.
    await Promise.resolve()
    fakeAdapter.triggerOpen()
    const socket = await connectPromise
    socket.close()

    const handshakeFrame = fakeAdapter.sent.find(f => f.startsWith(HANDSHAKE + DELIM))
    if (!handshakeFrame) throw new Error('no handshake frame sent')
    return parseHandshakeHeaders(handshakeFrame)
}

describe('WS auth-freshness gate', () => {

    it('recover runs before update, so the handshake carries the fresh token', async () => {
        await inContext(async () => {
            const callOrder: string[] = []

            WS_TOKEN.set('stale-ws-token')

            GGContextKeySynchronizer.provide(WS_TOKEN, {
                isStale: () => true,
                recover: async () => {
                    callOrder.push('recover')
                    WS_TOKEN.set('fresh-ws-token')
                },
            })

            const headers = await connectAndGetHandshakeHeaders({
                domain: 'ws://localhost',
                path: '/test',
                middlewares: [
                    {
                        key: WS_TOKEN,
                        update(outbound) {
                            callOrder.push('update')
                            const val = WS_TOKEN.get()
                            if (val !== undefined) outbound.headers['x-ws-token'] = val
                        },
                    },
                ],
            })

            expect(callOrder).toEqual(['recover', 'update'])
            expect(headers['x-ws-token']).toBe('fresh-ws-token')
        })
    })

    it('no controller — update fires normally and reads whatever the key holds', async () => {
        await inContext(async () => {
            WS_TOKEN.set('current-ws-token')

            const headers = await connectAndGetHandshakeHeaders({
                domain: 'ws://localhost',
                path: '/test',
                middlewares: [
                    {
                        key: WS_TOKEN,
                        update(outbound) {
                            const val = WS_TOKEN.get()
                            if (val !== undefined) outbound.headers['x-ws-token'] = val
                        },
                    },
                ],
            })

            expect(headers['x-ws-token']).toBe('current-ws-token')
        })
    })

    it('not stale — recover is never called', async () => {
        await inContext(async () => {
            const recover = vi.fn().mockResolvedValue(undefined)
            WS_TOKEN.set('good-ws-token')

            GGContextKeySynchronizer.provide(WS_TOKEN, {isStale: () => false, recover})

            await connectAndGetHandshakeHeaders({
                domain: 'ws://localhost',
                path: '/test',
                middlewares: [
                    {
                        key: WS_TOKEN,
                        update(outbound) {
                            const val = WS_TOKEN.get()
                            if (val !== undefined) outbound.headers['x-ws-token'] = val
                        },
                    },
                ],
            })

            expect(recover).not.toHaveBeenCalled()
        })
    })

    it('middleware without a key is unaffected', async () => {
        await inContext(async () => {
            const update = vi.fn()

            await connectAndGetHandshakeHeaders({
                domain: 'ws://localhost',
                path: '/test',
                middlewares: [{update}],
            })

            expect(update).toHaveBeenCalledTimes(1)
        })
    })

    it('no middlewares — handshake is sent with empty headers', async () => {
        await inContext(async () => {
            const headers = await connectAndGetHandshakeHeaders({
                domain: 'ws://localhost',
                path: '/test',
            })

            expect(headers).toEqual({})
        })
    })
})
