import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {RequirementDocsApi} from "./api/RequirementApi"
import {RequirementDocsService} from "./RequirementService"
import {USER_TOKEN_WIRE_HANDLER, WireUserService} from "./WireAuthService"

/** Intentionally misconfigured: the schema .use()s DOCS_AUTHORITY but this runtime never creates it. */
export class RequirementMissingAuthorityRuntime extends GGRuntime {
    public static readonly NAME = "requirement-missing-authority"

    protected compose(): void {
        const server = new GGHttpServer()
        USER_TOKEN_WIRE_HANDLER.create(new WireUserService())
        new GGHttp(server).http(RequirementDocsApi, new RequirementDocsService())
    }
}

RequirementMissingAuthorityRuntime.cli(import.meta.url).then()
