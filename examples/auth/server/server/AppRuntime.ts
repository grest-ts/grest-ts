import {GGRuntime} from "@grest-ts/runtime"
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {AuthToken, AuthGuard, HmacSigner, InMemoryRefreshTokenStore, scopeResolver} from "@grest-ts/auth"
import {IsObject} from "@grest-ts/schema"

import {AuthPublicApi} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {OrgApi} from "../../api/OrgApi"
import {BannerApi} from "../../api/BannerApi"
import {LiveApi} from "../../api/LiveApi"
import {USER_TOKEN, IsUserPermission, UserPermission} from "../../api/auth/UserAuth"
import {ORG_TOKEN, IsOrgPermission, IsOrgId, OrgPermission, OrgClaims} from "../../api/auth/OrgAuth"
import {UserContextMiddleware} from "./auth/UserContext"
import {OrgContextMiddleware} from "./auth/OrgContext"
import {UserService} from "./services/UserService"
import {OrgService} from "./services/OrgService"
import {BannerService} from "./services/BannerService"
import {LiveService} from "./services/LiveService"

const SECRET = "auth-example-secret-do-not-use-in-prod"

export class AppRuntime extends GGRuntime {
    public static readonly NAME = "auth"

    protected compose(): void {
        const server = new GGHttpServer()

        // ── User auth engine (JWT with refresh) ──────────────────────────────
        const userTokenEngine = new AuthToken<UserPermission>({
            signer: new HmacSigner(SECRET),
            store: new InMemoryRefreshTokenStore(),
            permission: IsUserPermission as any,
            accessTtlMs: 60 * 60 * 1000,       // 1 hour
            refreshTtlMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
        })
        const userGuard = new AuthGuard(userTokenEngine, USER_TOKEN)

        // ── Org auth engine (access-only derived token) ───────────────────────
        const orgTokenEngine = new AuthToken<OrgPermission, OrgClaims>({
            signer: new HmacSigner(SECRET + "-org"),
            permission: IsOrgPermission as any,
            claims: IsObject({orgId: IsOrgId}) as any,
            accessTtlMs: 8 * 60 * 60 * 1000,   // 8 hours
            refreshTtlMs: 0,                     // not used — access-only
        })
        const orgGuard = new AuthGuard(orgTokenEngine, ORG_TOKEN, {required: false})

        // ── Scope resolver: unions permissions from both token kinds ──────────
        const resolver = scopeResolver([userGuard, orgGuard])

        // ── Services ─────────────────────────────────────────────────────────
        const userService = new UserService(userTokenEngine)
        const orgService = new OrgService(orgTokenEngine)
        const bannerService = new BannerService()
        const liveService = new LiveService(userService, bannerService)

        const userContextMiddleware = new UserContextMiddleware(userService, userGuard)
        const orgContextMiddleware = new OrgContextMiddleware(orgService, orgGuard)

        // ── HTTP: public routes ───────────────────────────────────────────────
        new GGHttp(server)
            .http(AuthPublicApi, userService)

        // ── HTTP: protected routes (user + optional org) ──────────────────────
        new GGHttp(server)
            .use(userGuard.httpMiddleware())
            .use(orgGuard.httpMiddleware())
            .use(userContextMiddleware)
            .use(orgContextMiddleware)
            .usePermissions(resolver)
            .http(UserApi, userService)
            .http(OrgApi, orgService)
            .http(BannerApi, bannerService)

        // ── WebSocket: same token, same permission resolver ───────────────────
        LiveApi.register(liveService.handleConnection, {
            middlewares: [
                userGuard.wsMiddleware(),
                orgGuard.wsMiddleware(),
                userContextMiddleware,
            ],
            permissionResolver: resolver,
        })
    }
}

AppRuntime.cli(import.meta.url).then()
