import "./_dedupCheck";
export {toOpenApi} from "./toOpenApi";
export type {ToOpenApiOptions} from "./toOpenApi";
export {GGOpenApiDocs} from "./GGOpenApiDocs";
export type {GGOpenApiDocsOptions} from "./GGOpenApiDocs";
export {GGOpenApiDocsGroups} from "./GGOpenApiDocsGroups";
export type {GGOpenApiDocsGroupsOptions, SwaggerUiSwitcherConfig} from "./GGOpenApiDocsGroups";
// Backward-compatible aliases
export {GGOpenApiDocs as GGOpenApiServer} from "./GGOpenApiDocs";
export type {GGOpenApiDocsOptions as GGOpenApiServerOptions} from "./GGOpenApiDocs";
export {SchemaRegistry, toComponentName, errorComponentName} from "./SchemaRegistry";
export {schemaDescriptionToOpenApi, inlineSchemaResolver} from "./schemaDescriptionToOpenApi";
