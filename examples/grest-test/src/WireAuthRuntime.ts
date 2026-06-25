import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {WireLiveApi, WireOrgScopedApi, WirePublicApi, WireUserApi} from "./api/WireAuthApi"
import {ORG_TOKEN_WIRE_HANDLER, USER_TOKEN_WIRE_HANDLER, WireOrgService, WirePublicService, WireUserService} from "./WireAuthService"
import {WireLiveService} from "./WireLiveService"

export class WireAuthRuntime extends GGRuntime {
    public static readonly NAME = "wire-auth"

    protected compose(): void {
        const server = new GGHttpServer()
        const userService = new WireUserService()
        const orgService = new WireOrgService()

        // Bind each wire's deps into THIS runtime's scope. No usePermissions / no resolver list —
        // the schema carries the wires, the gate reads their permissions() (AND across sources).
        USER_TOKEN_WIRE_HANDLER.create(userService)
        ORG_TOKEN_WIRE_HANDLER.create(orgService)

        // WS uses the same USER_TOKEN_WIRE; no config — the schema's wire is the resolver.
        new GGHttp(server)
            .http(WireUserApi, userService)
            .http(WirePublicApi, new WirePublicService())
            .http(WireOrgScopedApi, orgService)
            .ws(WireLiveApi, new WireLiveService().handleConnection)
    }
}

WireAuthRuntime.cli(import.meta.url).then()
