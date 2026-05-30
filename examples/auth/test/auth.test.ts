import {EXISTS, NOT_AUTHORIZED, VALIDATION_ERROR} from "@grest-ts/schema"
import {GGTest} from "@grest-ts/testkit"
import "@grest-ts/http/testkit"
import {AppRuntime} from "../server/auth"
import {AuthPublicApi, InvalidCredentialsError} from "../common/api/AuthPublicApi"
import {UserApi} from "../common/api/UserApi"
import {LiveApi} from "../common/api/LiveApi"
import {TestContext} from "./TestContext"

describe("Registration", () => {
    GGTest.startWorker(AppRuntime)

    const ctx = new TestContext("Registration").apis({auth: AuthPublicApi})

    test("validates required fields", async () => {
        await ctx.auth
            .register({username: "ab", email: "not-an-email", password: ""})
            .toBeError(VALIDATION_ERROR)
            .toMatchObject({
                username: {__issue: {message: "Value must be between 3 and 20 characters"}},
                email: {__issue: {message: "Invalid email format"}},
                password: {__issue: {message: "Value must not be empty"}},
            })
    })

    test("registers a new user", async () => {
        const result = await ctx.auth
            .register({username: "alice", email: "alice@example.com", password: "secret123"})
            .toMatchObject({
                user: {username: "alice", email: "alice@example.com"},
                token: expect.stringMatching(/^token-/),
            })
        expect(result.user.id).toBeDefined()
    })

    test("rejects duplicate username", async () => {
        await ctx.auth
            .register({username: "alice", email: "other@example.com", password: "secret123"})
            .toBeError(EXISTS)
    })
})

describe("Login", () => {
    GGTest.startWorker(AppRuntime)

    const aliceData = {username: "alice", email: "alice@example.com", password: "secret123"}

    const ctx = new TestContext("Login")
        .resetAfterEach()
        .apis({auth: AuthPublicApi})
        .beforeAll(async () => { await ctx.callOn(AuthPublicApi).register(aliceData) })

    test("rejects wrong password", async () => {
        await ctx.auth
            .login({username: aliceData.username, password: "wrong-password"})
            .toBeError(InvalidCredentialsError)
    })

    test("rejects unknown username", async () => {
        await ctx.auth
            .login({username: "nobody", password: "whatever"})
            .toBeError(InvalidCredentialsError)
    })

    test("returns token and user on success", async () => {
        const result = await ctx.auth
            .login({username: aliceData.username, password: aliceData.password})
            .toMatchObject({
                user: {username: aliceData.username, email: aliceData.email},
                token: expect.stringMatching(/^token-/),
            })
        expect(result.token).toBeDefined()
    })
})

describe("Protected HTTP routes", () => {
    GGTest.startWorker(AppRuntime)

    const aliceData = {username: "alice", email: "alice@example.com", password: "secret123"}

    const ctx = new TestContext("Protected")
        .resetAfterEach()
        .apis({auth: AuthPublicApi, user: UserApi})
        // Use callOn directly so beforeAll doesn't set auth token in the context
        .beforeAll(async () => { await ctx.callOn(AuthPublicApi).register(aliceData) })

    test("rejects unauthenticated GET /me", async () => {
        await ctx.user.me().toBeError(NOT_AUTHORIZED)
    })

    test("rejects unauthenticated PUT /profile", async () => {
        await ctx.user.updateProfile({email: "hack@example.com"}).toBeError(NOT_AUTHORIZED)
    })

    test("returns current user after login", async () => {
        await ctx.login(aliceData)
        await ctx.user
            .me()
            .toMatchObject({username: aliceData.username, email: aliceData.email})
    })

    test("updates profile email", async () => {
        await ctx.login(aliceData)
        await ctx.user
            .updateProfile({email: "newalice@example.com"})
            .toMatchObject({username: aliceData.username, email: "newalice@example.com"})
        await ctx.user
            .me()
            .toMatchObject({email: "newalice@example.com"})
    })

    test("no-op update (empty body) returns current user unchanged", async () => {
        await ctx.login(aliceData)
        const before = await ctx.user.me()
        await ctx.user
            .updateProfile({})
            .toMatchObject({username: before.username, email: before.email})
    })
})

describe("WebSocket auth", () => {
    GGTest.startInline(AppRuntime)

    const aliceData = {username: "alice", email: "alice@example.com", password: "secret123"}

    const ctx = new TestContext("WebSocket")
        .apis({auth: AuthPublicApi, user: UserApi, live: LiveApi})
        .beforeAll(async () => {
            await ctx.register(aliceData)
            await ctx.live.connect()
        })

    test("rejects WebSocket connection without token", async () => {
        const anonCtx = new TestContext("Anon").apis({live: LiveApi})
        await expect(anonCtx.live.connect()).rejects.toBeDefined()
    })

    test("ping gets a pong with the authenticated username", async () => {
        await ctx.live
            .ping()
            .waitFor(ctx.live.mock.pong.toMatchObject({username: aliceData.username}))
    })

    test("HTTP profile update triggers WebSocket profileUpdated notification", async () => {
        await ctx.user
            .updateProfile({email: "ws-test@example.com"})
            .with(ctx.live.mock.profileUpdated.toMatchObject({
                username: aliceData.username,
                email: "ws-test@example.com",
            }))
    })
})
