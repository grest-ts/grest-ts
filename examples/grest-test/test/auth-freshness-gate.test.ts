import {describe, it, expect, vi} from 'vitest'
import {GGContext, GGContextKey, GGContextKeySynchronizer} from '@grest-ts/context'
import {GGRpcRequestBuilder} from '@grest-ts/http'
import {IsString, SERVER_ERROR} from '@grest-ts/schema'

const TOKEN_KEY = new GGContextKey<string | undefined>('auth-gate-test:token', IsString.orUndefined)

const minimalContract = {errors: [SERVER_ERROR]}

function inContext<T>(fn: () => Promise<T>): Promise<T> {
    return new GGContext('auth-gate-test').run(fn)
}

describe('auth-freshness HTTP gate', () => {

    it('recover runs before updateRequest reads the key, so the header carries the fresh value', async () => {
        await inContext(async () => {
            const callOrder: string[] = []

            TOKEN_KEY.set('stale-token')

            GGContextKeySynchronizer.provide(TOKEN_KEY, {
                isStale: () => true,
                recover: async () => {
                    callOrder.push('recover')
                    TOKEN_KEY.set('fresh-token')
                },
            })

            const builder = new GGRpcRequestBuilder('GET', '/test', {
                pathPrefix: '/',
                contract: minimalContract,
                middlewares: [
                    {
                        key: TOKEN_KEY,
                        headers: {'x-token': IsString.orUndefined},
                        responseHeaders: {},
                        updateRequest(req) {
                            callOrder.push('updateRequest')
                            const val = TOKEN_KEY.get()
                            if (val !== undefined) {
                                req.headers = req.headers ?? {}
                                req.headers['x-token'] = val
                            }
                        },
                    },
                ],
            })

            const request = await builder.createRequest(undefined)

            expect(callOrder).toEqual(['recover', 'updateRequest'])
            expect(request.headers['x-token']).toBe('fresh-token')
        })
    })

    it('no controller — updateRequest fires normally and reads whatever the key holds', async () => {
        await inContext(async () => {
            TOKEN_KEY.set('current-token')

            const builder = new GGRpcRequestBuilder('GET', '/test', {
                pathPrefix: '/',
                contract: minimalContract,
                middlewares: [
                    {
                        key: TOKEN_KEY,
                        headers: {'x-token': IsString.orUndefined},
                        responseHeaders: {},
                        updateRequest(req) {
                            const val = TOKEN_KEY.get()
                            if (val !== undefined) {
                                req.headers = req.headers ?? {}
                                req.headers['x-token'] = val
                            }
                        },
                    },
                ],
            })

            const request = await builder.createRequest(undefined)
            expect(request.headers['x-token']).toBe('current-token')
        })
    })

    it('not stale — recover is never called', async () => {
        await inContext(async () => {
            const recover = vi.fn().mockResolvedValue(undefined)
            TOKEN_KEY.set('good-token')

            GGContextKeySynchronizer.provide(TOKEN_KEY, {isStale: () => false, recover})

            const builder = new GGRpcRequestBuilder('GET', '/test', {
                pathPrefix: '/',
                contract: minimalContract,
                middlewares: [
                    {
                        key: TOKEN_KEY,
                        headers: {'x-token': IsString.orUndefined},
                        responseHeaders: {},
                        updateRequest(req) {
                            req.headers = req.headers ?? {}
                            req.headers['x-token'] = TOKEN_KEY.get() ?? ''
                        },
                    },
                ],
            })

            await builder.createRequest(undefined)
            expect(recover).not.toHaveBeenCalled()
        })
    })

    it('middleware without a key is unaffected', async () => {
        await inContext(async () => {
            const updateRequest = vi.fn()

            const builder = new GGRpcRequestBuilder('GET', '/test', {
                pathPrefix: '/',
                contract: minimalContract,
                middlewares: [
                    {
                        headers: {},
                        responseHeaders: {},
                        updateRequest,
                    },
                ],
            })

            await builder.createRequest(undefined)
            expect(updateRequest).toHaveBeenCalledTimes(1)
        })
    })
})
