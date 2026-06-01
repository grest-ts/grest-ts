import {describe, it, expect, vi} from 'vitest'
import {GGContext} from '@grest-ts/context'
import {GGHeader, GGRpcRequestBuilder} from '@grest-ts/http'
import {SERVER_ERROR} from '@grest-ts/schema'

const minimalContract = {errors: [SERVER_ERROR]}

function inContext<T>(fn: () => Promise<T>): Promise<T> {
    return new GGContext('auth-gate-test').run(fn)
}

describe('auth-freshness HTTP gate', () => {

    it('recover runs before the outbound read, so the header carries the fresh value', async () => {
        await inContext(async () => {
            const tokenWire = new GGHeader('x-token')
            tokenWire.set('stale-token')
            const recover = vi.fn(async () => { tokenWire.set('fresh-token') })
            tokenWire.defineClient({
                isStale: () => true,
                recover,
            })

            const builder = new GGRpcRequestBuilder('GET', '/test', {
                pathPrefix: '/',
                contract: minimalContract,
                middlewares: [tokenWire],
            })

            const request = await builder.createRequest(undefined)

            expect(recover).toHaveBeenCalledTimes(1)
            expect(request.headers['x-token']).toBe('fresh-token')
        })
    })

    it('no controller — update reads whatever the wire holds', async () => {
        await inContext(async () => {
            const tokenWire = new GGHeader('x-token')
            tokenWire.set('current-token')

            const builder = new GGRpcRequestBuilder('GET', '/test', {
                pathPrefix: '/',
                contract: minimalContract,
                middlewares: [tokenWire],
            })

            const request = await builder.createRequest(undefined)
            expect(request.headers['x-token']).toBe('current-token')
        })
    })

    it('not stale — recover is never called', async () => {
        await inContext(async () => {
            const recover = vi.fn().mockResolvedValue(undefined)

            const tokenWire = new GGHeader('x-token')
            tokenWire.set('good-token')
            tokenWire.defineClient({isStale: () => false, recover})

            const builder = new GGRpcRequestBuilder('GET', '/test', {
                pathPrefix: '/',
                contract: minimalContract,
                middlewares: [tokenWire],
            })

            await builder.createRequest(undefined)
            expect(recover).not.toHaveBeenCalled()
        })
    })

    it('a non-wire middleware is unaffected', async () => {
        await inContext(async () => {
            const update = vi.fn()

            const builder = new GGRpcRequestBuilder('GET', '/test', {
                pathPrefix: '/',
                contract: minimalContract,
                middlewares: [
                    {
                        headers: {},
                        responseHeaders: {},
                        update,
                    },
                ],
            })

            await builder.createRequest(undefined)
            expect(update).toHaveBeenCalledTimes(1)
        })
    })
})
