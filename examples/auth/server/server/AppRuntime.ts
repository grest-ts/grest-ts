import {GGRuntime} from "@grest-ts/runtime"
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGAuthAccessToken, GGAuthRefreshToken, HmacSigner, InMemoryRefreshTokenStore} from "@grest-ts/auth"
import {AuthPublicApi} from "../../api/AuthPublicApi"
import {UserApi} from "../../api/UserApi"
import {OrgApi, OrgScopedApi} from "../../api/OrgApi"
import {BannerApi} from "../../api/BannerApi"
import {LiveApi} from "../../api/LiveApi"
import {IsUserClaims} from "../../api/auth/UserAuth"
import {IsOrgUser} from "../../api/auth/OrgAuth"
import {USER_TOKEN_WIRE_HANDLER} from "./auth/UserAuthHandler"
import {ORG_TOKEN_WIRE_HANDLER} from "./auth/OrgAuthHandler"
import {UserService} from "./services/UserService"
import {OrgService} from "./services/OrgService"
import {BannerService} from "./services/BannerService"
import {LiveService} from "./services/LiveService"

const SECRET = "auth-example-secret-do-not-use-in-prod"

export class AppRuntime extends GGRuntime {
    public static readonly NAME = "auth"

    protected compose(): void {
        const server = new GGHttpServer()

        const userTokenEngine = new GGAuthRefreshToken({
            store: new InMemoryRefreshTokenStore(),
            refreshTtlMs: 7 * 24 * 60 * 60 * 1000,
            access: new GGAuthAccessToken({
                signer: new HmacSigner(SECRET),
                claimSchema: IsUserClaims,
                accessTtlMs: 60 * 60 * 1000
            })
        })
        const orgTokenEngine = new GGAuthAccessToken({
            signer: new HmacSigner(SECRET + "-org"),
            claimSchema: IsOrgUser,
            accessTtlMs: 8 * 60 * 60 * 1000,
        })

        const userService = new UserService(userTokenEngine)
        const orgService = new OrgService(orgTokenEngine)
        const bannerService = new BannerService()
        const liveService = new LiveService(userService, bannerService)

        // Bind the wires' deps into THIS runtime's scope. Once per runtime (a fresh test
        // worker / restart gets its own scope and may create again). No middleware chains,
        // no scopeResolver, no usePermissions — the schemas already carry the wires, and
        // startup refuses to serve a .use()d wire that was never created.
        USER_TOKEN_WIRE_HANDLER.create(userService)
        ORG_TOKEN_WIRE_HANDLER.create(orgService)

        new GGHttp(server)
            .http(AuthPublicApi, userService)   // no wire → public
            .http(UserApi, userService)
            .http(OrgApi, orgService)
            .http(OrgScopedApi, orgService)
            .http(BannerApi, bannerService)

        // The schema knows USER_TOKEN_WIRE; per-message permission gates come from the
        // contract. No explicit middleware/resolver list.
        LiveApi.register(liveService.handleConnection)
    }
}

AppRuntime.cli(import.meta.url).then()
