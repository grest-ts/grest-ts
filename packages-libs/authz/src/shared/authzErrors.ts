import {ERROR, IsArray, IsObject, IsString} from "@grest-ts/schema"
import {IsGGAuthzActionName, IsGGAuthzApprovalLevel, IsGGAuthzFactName, IsGGAuthzRn} from "./authzSchemas"

/** `resource` is what was decided; `key`, when set, is what the approval is for instead (a create's new row). */
export const APPROVAL_REQUIRED = ERROR.define("APPROVAL_REQUIRED", 403, IsObject({
    action: IsGGAuthzActionName,
    resource: IsGGAuthzRn,
    level: IsGGAuthzApprovalLevel,
    key: IsGGAuthzRn.orUndefined,
}))

/** OAuth `insufficient_scope`: a token with one of `scopes` would be allowed. */
export const INSUFFICIENT_SCOPE = ERROR.define("INSUFFICIENT_SCOPE", 403, IsObject({
    scopes: IsArray(IsString),
}))

/** Step-up authentication (RFC 9470): allowed once the caller re-authenticates so that `facts` hold. */
export const STEP_UP_REQUIRED = ERROR.define("STEP_UP_REQUIRED", 401, IsObject({
    facts: IsArray(IsGGAuthzFactName),
}))
