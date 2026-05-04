import "./_dedupCheck";
export {GGApiDocs} from "./GGApiDocs";
export type {GGApiDocsOptions, ApiDocSpec, ApiDocsGroup, ApiDocsBranding} from "./GGApiDocs";

export {buildApiDocs} from "./buildApiDocs";
export type {BuildApiDocsOptions} from "./buildApiDocs";

/**
 * Pure contract → ApiDocsDocument transformation. Useful in CI scripts that
 * want the JSON directly (e.g. for diffing against a checked-in baseline).
 */
export {buildContractDoc} from "./buildContractDoc";
export type {BuildContractDocOptions} from "./buildContractDoc";

/** Wrapper / schema types — the JSON format the UI consumes. */
export type {
    ApiDocsDocument,
    ApiDocsConfig,
    ApiDocsConfigEntry,
    ServiceDoc,
    GroupDoc,
    ContractDoc,
    MethodDoc,
    ParamDoc,
    SchemaRef,
    JsonSchemaDescription,
    JsonSchemaNodeKind,
    NamedSchemaDoc,
    SchemaUsage,
    ErrorDoc,
    ErrorUsage,
    AuthDoc,
    BrandingDoc,
} from "./docTypes";
