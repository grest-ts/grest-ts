import {GG_INTERNAL_AUTH_TOKEN, tInternalAuthToken} from "../common/api-internal/auth/InternalAuthUse";
import {GGMetricsLoader} from "@grest-ts/metrics";
import {GGRuntime} from "@grest-ts/runtime";

export abstract class MyRuntime extends GGRuntime {

    protected compose(): void {
        GG_INTERNAL_AUTH_TOKEN.set("internal_auth_token" as tInternalAuthToken)
        new GGMetricsLoader();
    }
}