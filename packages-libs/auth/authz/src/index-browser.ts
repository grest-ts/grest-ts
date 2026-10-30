import "./_dedupCheck";
export * from "./shared/authzSchemas"
export {APPROVAL_REQUIRED, INSUFFICIENT_SCOPE, STEP_UP_REQUIRED} from "./shared/authzErrors"
export {GGAuthzRn} from "./shared/GGAuthzRn"
export type {GGAuthzRnParts, GGAuthzRnSegment} from "./shared/GGAuthzRn"
export {defineAuthzModel, defineAuthzRole, defineAuthzService, defineAuthzTokenScope} from "./shared/defineAuthz"
export type {
    GGAuthzActionRef,
    GGAuthzActionSpec,
    GGAuthzDefinedAction,
    GGAuthzDefinedRole,
    GGAuthzDefinedTokenScope,
    GGAuthzModelSpec,
    GGAuthzRuleSpec,
    GGAuthzService,
    GGAuthzServiceSpec,
} from "./shared/defineAuthz"
export {GG_AUTHZ_ERRORS} from "./shared/requirement"
export type {GGAuthzActionBuilders, GGAuthzError, GGAuthzRequirement} from "./shared/requirement"
