import {EXISTS, FORBIDDEN, NOT_AUTHORIZED, VALIDATION_ERROR} from "@grest-ts/schema"
import {GGTest} from "@grest-ts/testkit"
import "@grest-ts/http/testkit"
import {AppRuntime} from "../server/AppRuntime"
import {AuthPublicApi, InvalidCredentialsError} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {OrgApi} from "../../api/OrgApi"
import {BannerApi} from "../../api/BannerApi"
import {LiveApi} from "../../api/LiveApi"
import {TestContext} from "./TestContext"

const aliceData = {username: "alice", email: "alice@example.com", password: "secret123"}
const bobData   = {username: "bob",   email: "bob@example.com",   password: "secret123"}

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

    test("registers alice with CAN_SEE_RED_BANNER in JWT", async () => {
        const result = await ctx.auth
            .register(aliceData)
            .toMatchObject({
                data: {username: "alice", email: "alice@example.com"},
                access: {token: expect.any(String)},
                refresh: {token: expect.any(String)},
            })
        expect(result.access.token).toMatch(/^ey/)  // JWT format
    })

    test("rejects duplicate username", async () => {
        await ctx.auth
            .register(aliceData)
            .toBeError(EXISTS)
    })
})

describe("Login", () => {
    GGTest.startWorker(AppRuntime)

    const ctx = new TestContext("Login")
        .resetAfterEach()
        .apis({auth: AuthPublicApi})
        .beforeAll(async () => { await ctx.callOn(AuthPublicApi).register(aliceData) })

    test("rejects wrong password", async () => {
        await ctx.auth
            .login({username: aliceData.username, password: "wrong"})
            .toBeError(InvalidCredentialsError)
    })

    test("returns JWT on success", async () => {
        const result = await ctx.auth
            .login(aliceData)
            .toMatchObject({data: {username: aliceData.username}})
        expect(result.access.token).toMatch(/^ey/)
    })
})

describe("Protected HTTP routes", () => {
    GGTest.startWorker(AppRuntime)

    const ctx = new TestContext("Protected")
        .resetAfterEach()
        .apis({auth: AuthPublicApi, user: UserApi})
        .beforeAll(async () => { await ctx.callOn(AuthPublicApi).register(aliceData) })

    test("rejects unauthenticated GET /me", async () => {
        await ctx.user.me().toBeError(NOT_AUTHORIZED)
    })

    test("returns current user after login", async () => {
        await ctx.login(aliceData)
        await ctx.user.me().toMatchObject({username: aliceData.username, email: aliceData.email})
    })

    test("updates profile email", async () => {
        await ctx.login(aliceData)
        await ctx.user.updateProfile({email: "newalice@example.com"})
            .toMatchObject({username: aliceData.username, email: "newalice@example.com"})
    })
})

describe("Banner permission gate", () => {
    GGTest.startWorker(AppRuntime)

    const ctxAlice = new TestContext("Alice").resetAfterEach().apis({auth: AuthPublicApi, banner: BannerApi})
    const ctxBob   = new TestContext("Bob").resetAfterEach().apis({auth: AuthPublicApi, banner: BannerApi})

    beforeAll(async () => {
        await ctxAlice.callOn(AuthPublicApi).register(aliceData)
        await ctxBob.callOn(AuthPublicApi).register(bobData)
    })

    test("anyone authenticated can read banner status", async () => {
        await ctxBob.login(bobData)
        await ctxBob.banner.bannerStatus().toMatchObject({count: expect.any(Number)})
    })

    test("alice (CAN_SEE_RED_BANNER) can click banner", async () => {
        await ctxAlice.login(aliceData)
        await ctxAlice.banner.clickBanner().toMatchObject({count: 1, username: "alice"})
        await ctxAlice.banner.clickBanner().toMatchObject({count: 2, username: "alice"})
    })

    test("bob (no permission) gets FORBIDDEN on click", async () => {
        await ctxBob.login(bobData)
        await ctxBob.banner.clickBanner().toBeError(FORBIDDEN)
    })

    test("unauthenticated click returns NOT_AUTHORIZED", async () => {
        await ctxBob.banner.clickBanner().toBeError(NOT_AUTHORIZED)
    })
})

describe("Organization selector", () => {
    GGTest.startWorker(AppRuntime)

    const ctx = new TestContext("Org").resetAfterEach().apis({auth: AuthPublicApi, org: OrgApi})

    beforeAll(async () => { await ctx.callOn(AuthPublicApi).register(aliceData) })

    test("lists orgs for alice", async () => {
        await ctx.login(aliceData)
        await ctx.org.listOrgs().toMatchObject([
            {name: "Acme Corp"},
            {name: "Beta Labs"},
        ])
    })

    test("orgInfo requires org token (FORBIDDEN without it)", async () => {
        await ctx.login(aliceData)
        await ctx.org.orgInfo().toBeError(FORBIDDEN)
    })

    test("orgInfo succeeds after selectOrg", async () => {
        await ctx.login(aliceData)
        const res = await ctx.org.selectOrg({orgId: "org-1" as any})
        ctx.setOrgToken(res.access.token)
        await ctx.org.orgInfo().toMatchObject({name: res.data.name})
    })

    test("non-member cannot select org", async () => {
        await ctx.callOn(AuthPublicApi).register(bobData)
        await ctx.login(bobData)
        // bob is only member of org-1, not org-2
        await ctx.org.selectOrg({orgId: "org-2" as any}).toBeError(FORBIDDEN)
    })
})

describe("WebSocket auth + permissions", () => {
    GGTest.startInline(AppRuntime)

    const ctx = new TestContext("WebSocket")
        .apis({auth: AuthPublicApi, user: UserApi, live: LiveApi, banner: BannerApi})
        .beforeAll(async () => {
            await ctx.register(aliceData)
            await ctx.live.connect()
        })

    test("ping gets a pong with the authenticated username", async () => {
        await ctx.live
            .ping()
            .waitFor(ctx.live.mock.pong.toMatchObject({username: aliceData.username}))
    })

    test("HTTP profile update triggers WebSocket profileUpdated", async () => {
        await ctx.user
            .updateProfile({email: "ws-test@example.com"})
            .with(ctx.live.mock.profileUpdated.toMatchObject({email: "ws-test@example.com"}))
    })

    test("alice can send bannerPing (has CAN_SEE_RED_BANNER)", async () => {
        await ctx.live
            .bannerPing()
            .waitFor(ctx.live.mock.bannerPong.toMatchObject({username: aliceData.username}))
    })

    test("HTTP banner click pushes bannerPong to all WS clients", async () => {
        await ctx.banner
            .clickBanner()
            .with(ctx.live.mock.bannerPong.toMatchObject({username: aliceData.username}))
    })
})
