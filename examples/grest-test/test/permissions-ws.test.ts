import {GG_TEST_RUNNER, GGTest} from "@grest-ts/testkit"
import {GGContext} from "@grest-ts/context"
import {MainRuntime} from "../src/main"
import {AppPermission, TEST_SCOPES_WIRE} from "../src/api/PermissionsApi"
import {
    WsFeaturePermissionsApi,
    WsPermissionsApi,
    WS_TEST_RESOLVER_THROW_SCOPE,
} from "../src/api/WsPermissionsApi"

function urlFor(apiName: string): string {
    return GG_TEST_RUNNER.get().discoveryServer.getRoutingUrl(apiName)
}

// null → omit the credential wire (no identity → handshake rejects with NOT_AUTHORIZED).
async function withClientScopes<R>(scopes: string[] | null, fn: () => Promise<R>): Promise<R> {
    const scope = new GGContext("ws-perm-test")
    if (scopes && scopes.length > 0) scope.set(TEST_SCOPES_WIRE, scopes.join(","))
    return await scope.run(fn)
}

describe("WebSocket permission gate", () => {

    GGTest.startWorker(MainRuntime)

    describe("per-message gate (multiplex socket, no connectPermission)", () => {
        test("no identity → handshake rejected with NOT_AUTHORIZED", async () => {
            // The schema carries a required-or-throw credential wire; omitting it
            // fails the wire's process() at handshake, so connect() rejects.
            await withClientScopes(null, async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await expect(client.connect()).rejects.toMatchObject({type: "NOT_AUTHORIZED"})
            })
        })

        test("public message works for any authenticated caller (public-within-authed)", async () => {
            await withClientScopes(["any"], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    expect(await client.outgoing.publicMessage("hi")).toBe("pub:hi")
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("needsRead with matching scope passes", async () => {
            await withClientScopes([AppPermission.Read], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    expect(await client.outgoing.needsRead("ok")).toBe("read:ok")
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("needsRead with wrong scope → FORBIDDEN", async () => {
            await withClientScopes([AppPermission.Admin], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    await expect(client.outgoing.needsRead("x")).rejects.toMatchObject({type: "FORBIDDEN"})
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("allOf gate requires both", async () => {
            await withClientScopes([AppPermission.Read], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    await expect(client.outgoing.needsAllReadWrite("x")).rejects.toMatchObject({type: "FORBIDDEN"})
                } finally {
                    await client.disconnect()
                }
            })
            await withClientScopes([AppPermission.Read, AppPermission.Write], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    expect(await client.outgoing.needsAllReadWrite("ok")).toBe("rw:ok")
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("anyOf gate accepts either branch", async () => {
            await withClientScopes([AppPermission.Admin], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    expect(await client.outgoing.needsAnyReadOrAdmin("a")).toBe("roa:a")
                } finally {
                    await client.disconnect()
                }
            })
            await withClientScopes([AppPermission.Read], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    expect(await client.outgoing.needsAnyReadOrAdmin("b")).toBe("roa:b")
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("public messages still work even when other gates would block — connection stays open", async () => {
            await withClientScopes([AppPermission.Read], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    expect(await client.outgoing.needsRead("ok")).toBe("read:ok")
                    await expect(client.outgoing.needsAllReadWrite("x")).rejects.toMatchObject({type: "FORBIDDEN"})
                    // Connection still alive — same socket handles the next public call.
                    expect(await client.outgoing.publicMessage("alive")).toBe("pub:alive")
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("scopes are cached at handshake — header changes after connect have no effect", async () => {
            const scope = new GGContext("ws-cache-test")
            scope.set(TEST_SCOPES_WIRE, AppPermission.Read)
            await scope.run(async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect()
                try {
                    expect(await client.outgoing.needsRead("a")).toBe("read:a")
                    // Mutating the wire in the test context does NOT affect the live socket.
                    scope.set(TEST_SCOPES_WIRE, AppPermission.Admin)
                    expect(await client.outgoing.needsRead("b")).toBe("read:b")
                } finally {
                    await client.disconnect()
                }
            })
        })

        // s2c to no-identity callers belongs on a PUBLIC (wireless) socket — covered by
        // websocket-client.test.ts "serverToClient push". This gated schema only has
        // authenticated callers, so we keep just the authenticated-receives-s2c case.
        test("authenticated callers also receive s2c pushes — same behavior, same code path", async () => {
            await withClientScopes([AppPermission.Read], async () => {
                const received: string[] = []
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await client.connect(({incoming}) => {
                    incoming.on({
                        echo: async (text: string) => { received.push(text) },
                    })
                })
                try {
                    await new Promise(r => setTimeout(r, 150))
                    expect(received).toEqual(["hello-from-server"])
                } finally {
                    await client.disconnect()
                }
            })
        })
    })

    describe("resolver crashes at handshake", () => {
        test("resolver throws → handshake fails, client.connect() rejects", async () => {
            // Sentinel scope makes the wire's permissions() throw inside the handshake
            // permission middleware. The handshake's try/catch surfaces it to
            // the client as a HANDSHAKE_ERR.
            await withClientScopes([WS_TEST_RESOLVER_THROW_SCOPE], async () => {
                const client = WsPermissionsApi.createClient({url: urlFor("WsPermissionsApi")})
                await expect(client.connect()).rejects.toBeDefined()
            })
        })
    })

    describe("connectPermission (feature socket)", () => {
        test("connecting without required connect scope rejects the handshake with FORBIDDEN", async () => {
            await withClientScopes([AppPermission.Read], async () => {
                const client = WsFeaturePermissionsApi.createClient({url: urlFor("WsFeaturePermissionsApi")})
                await expect(client.connect()).rejects.toMatchObject({type: "FORBIDDEN"})
            })
        })

        test("connecting without any identity rejects the handshake with NOT_AUTHORIZED", async () => {
            await withClientScopes(null, async () => {
                const client = WsFeaturePermissionsApi.createClient({url: urlFor("WsFeaturePermissionsApi")})
                await expect(client.connect()).rejects.toMatchObject({type: "NOT_AUTHORIZED"})
            })
        })

        test("connecting with required connect scope succeeds and per-message gate also runs", async () => {
            await withClientScopes([AppPermission.Admin, AppPermission.Read], async () => {
                const client = WsFeaturePermissionsApi.createClient({url: urlFor("WsFeaturePermissionsApi")})
                await client.connect()
                try {
                    expect(await client.outgoing.ping()).toBe("pong")
                } finally {
                    await client.disconnect()
                }
            })
        })

        test("connecting with connect scope but lacking per-message scope → FORBIDDEN on the message", async () => {
            await withClientScopes([AppPermission.Admin], async () => {
                const client = WsFeaturePermissionsApi.createClient({url: urlFor("WsFeaturePermissionsApi")})
                await client.connect()
                try {
                    await expect(client.outgoing.ping()).rejects.toMatchObject({type: "FORBIDDEN"})
                } finally {
                    await client.disconnect()
                }
            })
        })
    })
})
