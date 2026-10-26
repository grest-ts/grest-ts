import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {RequirementDocsApi} from "./api/RequirementApi"
import {AUTHORITY_SEEN, DOCS_AUTHORITY_HANDLER, RequirementDocsService} from "./RequirementService"
import {USER_TOKEN_WIRE_HANDLER, WireUserService} from "./WireAuthService"

export class RequirementRuntime extends GGRuntime {
    public static readonly NAME = "requirement"

    protected compose(): void {
        const server = new GGHttpServer()
        USER_TOKEN_WIRE_HANDLER.create(new WireUserService())
        DOCS_AUTHORITY_HANDLER.create(AUTHORITY_SEEN)
        new GGHttp(server).http(RequirementDocsApi, new RequirementDocsService())
    }
}

RequirementRuntime.cli(import.meta.url).then()
