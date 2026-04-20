/**
 * Minimal AsyncAPI 3.0 type definitions.
 * Only the subset used by @grest-ts/asyncapi — enough for correct spec generation.
 */

export interface AsyncAPIDocument {
    asyncapi: "3.0.0";
    info: InfoObject;
    servers?: Record<string, ServerObject>;
    channels: Record<string, ChannelObject>;
    operations: Record<string, OperationObject>;
    components?: ComponentsObject;
}

export interface InfoObject {
    title: string;
    version: string;
    description?: string;
}

export interface ServerObject {
    host: string;
    protocol: "ws" | "wss" | "http" | "https";
    description?: string;
}

export interface ChannelObject {
    address: string;
    description?: string;
    title?: string;
    messages?: Record<string, MessageObject | ReferenceObject>;
    bindings?: ChannelBindingsObject;
}

export interface ChannelBindingsObject {
    ws?: WsChannelBinding;
}

export interface WsChannelBinding {
    method?: "GET" | "POST";
    headers?: SchemaObject;
    bindingVersion?: string;
}

export interface OperationObject {
    action: "send" | "receive";
    channel: ReferenceObject;
    title?: string;
    summary?: string;
    description?: string;
    messages?: ReferenceObject[];
    reply?: OperationReplyObject;
    security?: SecurityRequirementObject[];
}

export interface OperationReplyObject {
    channel?: ReferenceObject;
    messages?: ReferenceObject[];
}

export interface MessageObject {
    name?: string;
    title?: string;
    summary?: string;
    description?: string;
    payload?: SchemaObject | ReferenceObject;
    headers?: SchemaObject;
    contentType?: string;
}

export interface ComponentsObject {
    schemas?: Record<string, SchemaObject>;
    messages?: Record<string, MessageObject>;
    securitySchemes?: Record<string, SecuritySchemeObject>;
}

export interface SchemaObject {
    type?: string | string[];
    properties?: Record<string, SchemaObject | ReferenceObject>;
    required?: string[];
    additionalProperties?: boolean | SchemaObject;
    items?: SchemaObject | ReferenceObject;
    prefixItems?: (SchemaObject | ReferenceObject)[];
    oneOf?: (SchemaObject | ReferenceObject)[];
    anyOf?: (SchemaObject | ReferenceObject)[];
    allOf?: (SchemaObject | ReferenceObject)[];
    enum?: unknown[];
    const?: unknown;
    format?: string;
    title?: string;
    description?: string;
    example?: unknown;
    examples?: unknown[];
    deprecated?: boolean;
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
    discriminator?: {propertyName: string};
    [key: string]: unknown;
}

export interface ReferenceObject {
    $ref: string;
}

export interface SecuritySchemeObject {
    type: "http" | "apiKey" | "userPassword" | "X509" | "symmetricEncryption" | "asymmetricEncryption" | "plain" | "scramSha256" | "scramSha512" | "gssapi" | "oauth2" | "openIdConnect";
    scheme?: string;
    description?: string;
    name?: string;
    in?: "user" | "password" | "query" | "header" | "cookie";
}

/** AsyncAPI 3.0 security: [{$ref: "#/components/securitySchemes/Name"}] */
export type SecurityRequirementObject = ReferenceObject | {[name: string]: string[]};
