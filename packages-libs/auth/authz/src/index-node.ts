import "./_dedupCheck";
export * from "./index-browser"
export {GGAuthz} from "./node/GGAuthz"
export type {GGAuthzApprovals, GGAuthzConfig, GGAuthzFacts, GGAuthzInactiveAction, GGAuthzResolver} from "./node/GGAuthz"
export {GGAuthzAuthority} from "./node/GGAuthzAuthority"
export type {
    GGAuthzApprovalKey,
    GGAuthzApprovalNeed,
    GGAuthzAuthorityConfig,
    GGAuthzCall,
    GGAuthzLoaded,
    GGAuthzLoader,
    GGAuthzResolvedResource,
    GGAuthzResourceRef,
} from "./node/GGAuthzAuthority"
export {GGAuthzMemoryResolver} from "./node/GGAuthzMemoryResolver"
export type {GGAuthzMemoryData} from "./node/GGAuthzMemoryResolver"
export {GG_AUTHZ_SUBJECT} from "./node/GG_AUTHZ_SUBJECT"
export type {GGAuthzApplyPlanOptions} from "./node/applyPlan"
