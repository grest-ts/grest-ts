import {describe, it, expect, vi} from 'vitest'
import {GGContext} from '@grest-ts/context'
import {GGContextKey} from '@grest-ts/context'
import {GGContextKeySynchronizer} from './GGContextKeySynchronizer'
import {IsString} from '@grest-ts/schema'

const KEY_A = new GGContextKey<string | undefined>('sync-test:a', IsString.orUndefined)
const KEY_B = new GGContextKey<string | undefined>('sync-test:b', IsString.orUndefined)

function inContext<T>(fn: () => Promise<T>): Promise<T> {
    return new GGContext('test').run(fn)
}

describe('GGContextKeySynchronizer', () => {

    describe('waitFor — no controller', () => {
        it('resolves immediately when no controller is registered', async () => {
            await inContext(async () => {
                await expect(GGContextKeySynchronizer.waitFor(KEY_A)).resolves.toBeUndefined()
            })
        })
    })

    describe('waitFor — not stale', () => {
        it('does not call recover when isStale returns false', async () => {
            await inContext(async () => {
                const recover = vi.fn().mockResolvedValue(undefined)
                GGContextKeySynchronizer.provide(KEY_A, {isStale: () => false, recover})
                await GGContextKeySynchronizer.waitFor(KEY_A)
                expect(recover).not.toHaveBeenCalled()
            })
        })
    })

    describe('waitFor — stale once', () => {
        it('calls recover once and after it resolves a second waitFor does not call recover again', async () => {
            await inContext(async () => {
                let stale = true
                const recover = vi.fn(async () => { stale = false })
                GGContextKeySynchronizer.provide(KEY_A, {isStale: () => stale, recover})

                await GGContextKeySynchronizer.waitFor(KEY_A)
                expect(recover).toHaveBeenCalledTimes(1)

                await GGContextKeySynchronizer.waitFor(KEY_A)
                expect(recover).toHaveBeenCalledTimes(1)
            })
        })
    })

    describe('waitFor — coalescing', () => {
        it('fires recover exactly once for 5 concurrent waitFor calls', async () => {
            await inContext(async () => {
                let resolveRecover!: () => void
                const recoverDone = new Promise<void>(res => { resolveRecover = res })
                const recover = vi.fn(() => recoverDone)

                GGContextKeySynchronizer.provide(KEY_B, {isStale: () => true, recover})

                const waits = Promise.all([
                    GGContextKeySynchronizer.waitFor(KEY_B),
                    GGContextKeySynchronizer.waitFor(KEY_B),
                    GGContextKeySynchronizer.waitFor(KEY_B),
                    GGContextKeySynchronizer.waitFor(KEY_B),
                    GGContextKeySynchronizer.waitFor(KEY_B),
                ])

                resolveRecover()
                await waits
                expect(recover).toHaveBeenCalledTimes(1)
            })
        })
    })

    describe('waitFor — recover rejects', () => {
        it('rejects waitFor when recover rejects, then clears inflight so next call can retry', async () => {
            await inContext(async () => {
                let callCount = 0
                const recover = vi.fn(async () => {
                    callCount++
                    if (callCount === 1) throw new Error('refresh failed')
                })

                GGContextKeySynchronizer.provide(KEY_A, {isStale: () => true, recover})

                await expect(GGContextKeySynchronizer.waitFor(KEY_A)).rejects.toThrow('refresh failed')
                expect(recover).toHaveBeenCalledTimes(1)

                await expect(GGContextKeySynchronizer.waitFor(KEY_A)).resolves.toBeUndefined()
                expect(recover).toHaveBeenCalledTimes(2)
            })
        })
    })

    describe('clear', () => {
        it('removes the controller so subsequent waitFor is a no-op', async () => {
            await inContext(async () => {
                const recover = vi.fn().mockResolvedValue(undefined)
                GGContextKeySynchronizer.provide(KEY_A, {isStale: () => true, recover})
                GGContextKeySynchronizer.clear(KEY_A)
                await GGContextKeySynchronizer.waitFor(KEY_A)
                expect(recover).not.toHaveBeenCalled()
            })
        })
    })
})
