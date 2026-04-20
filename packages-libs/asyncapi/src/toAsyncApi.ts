import type {GGWebSocketSchema} from "@grest-ts/websocket";
import type {ANY_ERROR_CLS, GGSchema} from "@grest-ts/schema";
import {schemaDescriptionToOpenApi, SchemaRegistry} from "@grest-ts/openapi";
import type {
    AsyncAPIDocument, ChannelObject, MessageObject,
    OperationObject, ReferenceObject, SchemaObject, SecurityRequirementObject,
    SecuritySchemeObject
} from "./AsyncApiTypes";

export interface ToAsyncApiOptions {
    title?: string;
    version?: string;
    description?: string;
    servers?: Record<string, {host: string; protocol: "ws" | "wss"; description?: string}>;
}

/**
 * Convert a list of GGWebSocketSchema instances to an AsyncAPI 3.0 document.
 *
 * Message patterns:
 *   - clientToServer with success/errors: request/response (action:send + reply)
 *   - clientToServer without success/errors: fire-and-forget (action:send, no reply)
 *   - serverToClient with input: server push (action:receive, no reply)
 *   - serverToClient with success/errors: server-initiated request (action:receive + reply)
 *
 * All patterns are symmetric: reply.messages lists ALL possible response messages
 * (success + each error type), correctly modelling that both parties can receive
 * any of them.
 */
export function toAsyncApi(
    schemas: GGWebSocketSchema<any, any, any, any, any>[],
    options: ToAsyncApiOptions = {},
    serverPort?: number
): AsyncAPIDocument {
    const registry = new SchemaRegistry();
    const channels: Record<string, ChannelObject> = {};
    const operations: Record<string, OperationObject> = {};
    const securitySchemes = new Map<string, SecuritySchemeObject>();

    for (const wsSchema of schemas) {
        const contract = wsSchema.contract;
        const channelId = sanitizeId(wsSchema.name);
        const path = wsSchema.path.startsWith('/') ? wsSchema.path : '/' + wsSchema.path;
        const channelRef: ReferenceObject = {$ref: `#/channels/${channelId}`};

        const {handshakeHeaders, channelSecurity} = buildHandshakeOpenApi(
            wsSchema.middlewares as any[], securitySchemes
        );

        const messages: Record<string, MessageObject | ReferenceObject> = {};

        // ── clientToServer ──────────────────────────────────────────────────
        const c2s = contract.clientToServer;
        for (const methodName of Object.keys(c2s.methods)) {
            const method = c2s.methods[methodName];
            const msgId = `${channelId}_${methodName}`;
            const hasReply = ('success' in method && method.success != null)
                || (method.errors && method.errors.length > 0);
            const requestMsgId = hasReply ? `${msgId}_request` : msgId;

            // Request (or fire-and-forget) message
            messages[requestMsgId] = buildMessage(
                hasReply ? `${methodName} request` : methodName,
                method.input ?? undefined,
                registry,
                !hasReply ? buildFireAndForgetDescription(method) : undefined
            );

            // Response + error messages
            const replyMsgRefs: ReferenceObject[] = [];
            if (hasReply) {
                const successMsgId = `${msgId}_response`;
                messages[successMsgId] = buildResponseMessage(methodName, method, registry);
                replyMsgRefs.push({$ref: `#/channels/${channelId}/messages/${successMsgId}`});

                for (const errCls of (method.errors ?? []) as ANY_ERROR_CLS[]) {
                    const errMsgId = `${msgId}_error_${errCls.TYPE}`;
                    messages[errMsgId] = buildErrorMessage(methodName, errCls, registry);
                    replyMsgRefs.push({$ref: `#/channels/${channelId}/messages/${errMsgId}`});
                }
            }

            const operationId = `${wsSchema.name}_send_${methodName}`;
            const operation: OperationObject = {
                action: 'send',
                channel: channelRef,
                title: camelToTitle(methodName),
                ...(hasReply
                    ? {description: `${camelToTitle(methodName)} — request/response`}
                    : {description: `${camelToTitle(methodName)} — fire-and-forget`}),
                messages: [{$ref: `#/channels/${channelId}/messages/${requestMsgId}`}],
            };
            if (channelSecurity.length) operation.security = channelSecurity;
            if (hasReply && replyMsgRefs.length) {
                operation.reply = {channel: channelRef, messages: replyMsgRefs};
            }
            operations[operationId] = operation;
        }

        // ── serverToClient ──────────────────────────────────────────────────
        const s2c = contract.serverToClient;
        for (const methodName of Object.keys(s2c.methods)) {
            const method = s2c.methods[methodName];
            const msgId = `${channelId}_${methodName}`;

            // Server-initiated request (has success — server sends, client responds)
            const hasReply = ('success' in method && method.success != null)
                || (method.errors && method.errors.length > 0);

            if (hasReply) {
                // Server sends the trigger message
                const triggerMsgId = `${msgId}_trigger`;
                messages[triggerMsgId] = buildMessage(
                    `${methodName} trigger`,
                    method.input ?? undefined,
                    registry,
                    `${camelToTitle(methodName)} — server-initiated request`
                );

                // Client sends back the response
                const responseMsgId = `${msgId}_response`;
                messages[responseMsgId] = buildResponseMessage(methodName, method, registry);

                const replyMsgRefs: ReferenceObject[] = [
                    {$ref: `#/channels/${channelId}/messages/${responseMsgId}`}
                ];
                for (const errCls of (method.errors ?? []) as ANY_ERROR_CLS[]) {
                    const errMsgId = `${msgId}_error_${errCls.TYPE}`;
                    messages[errMsgId] = buildErrorMessage(methodName, errCls, registry);
                    replyMsgRefs.push({$ref: `#/channels/${channelId}/messages/${errMsgId}`});
                }

                operations[`${wsSchema.name}_receive_${methodName}`] = {
                    action: 'receive',
                    channel: channelRef,
                    title: camelToTitle(methodName),
                    description: `${camelToTitle(methodName)} — server-initiated request/response`,
                    messages: [{$ref: `#/channels/${channelId}/messages/${triggerMsgId}`}],
                    ...(channelSecurity.length ? {security: channelSecurity} : {}),
                    reply: {channel: channelRef, messages: replyMsgRefs},
                };
            } else {
                // Pure server push — no reply
                messages[msgId] = buildMessage(
                    methodName,
                    method.input ?? undefined,
                    registry
                );
                operations[`${wsSchema.name}_receive_${methodName}`] = {
                    action: 'receive',
                    channel: channelRef,
                    title: camelToTitle(methodName),
                    description: `${camelToTitle(methodName)} — server push`,
                    messages: [{$ref: `#/channels/${channelId}/messages/${msgId}`}],
                    ...(channelSecurity.length ? {security: channelSecurity} : {}),
                };
            }
        }

        channels[channelId] = {
            address: path,
            title: camelToTitle(wsSchema.name),
            messages,
            ...(handshakeHeaders ? {bindings: {ws: {method: 'GET', headers: handshakeHeaders}}} : {}),
        };
    }

    const doc: AsyncAPIDocument = {
        asyncapi: "3.0.0",
        info: {
            title: options.title ?? "API",
            version: options.version ?? "1.0.0",
            ...(options.description ? {description: options.description} : {}),
        },
        channels,
        operations,
    };

    // Auto-add server entry from port if available
    const servers = options.servers
        ?? (serverPort ? {default: {host: `localhost:${serverPort}`, protocol: 'ws'}} : undefined);
    if (servers) doc.servers = servers;

    const rawSchemaComponents = registry.getComponents();
    const schemaComponents = rawSchemaComponents
        ? Object.fromEntries(
            Object.entries(rawSchemaComponents).map(([k, v]) => [k, fixSchemaForAsyncApi(v)])
          ) as Record<string, SchemaObject>
        : undefined;
    const securityComponents = securitySchemes.size > 0
        ? Object.fromEntries(securitySchemes)
        : undefined;

    if (schemaComponents || securityComponents) {
        doc.components = {
            ...(schemaComponents ? {schemas: schemaComponents} : {}),
            ...(securityComponents ? {securitySchemes: securityComponents} : {}),
        };
    }

    return doc;
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

function buildMessage(
    name: string,
    inputSchema: GGSchema<any> | undefined,
    registry: SchemaRegistry,
    description?: string
): MessageObject {
    const msg: MessageObject = {
        name,
        title: camelToTitle(name),
        ...(description ? {description} : {}),
    };
    if (inputSchema) {
        const schema = registry.descOrRef(inputSchema.toSchemaDescription());
        msg.payload = fixSchemaForAsyncApi(schema) as SchemaObject;
    }
    return msg;
}

function buildResponseMessage(
    methodName: string,
    method: {success?: GGSchema<any>},
    registry: SchemaRegistry
): MessageObject {
    const msg: MessageObject = {
        name: `${methodName} response`,
        title: `${camelToTitle(methodName)} response`,
    };
    if (method.success) {
        const dataSchema = registry.descOrRef(method.success.toSchemaDescription());
        msg.payload = fixSchemaForAsyncApi({
            type: 'object',
            properties: {
                success: {type: 'boolean', enum: [true]},
                type: {type: 'string', enum: ['OK']},
                data: dataSchema as SchemaObject
            },
            required: ['success', 'type', 'data']
        }) as SchemaObject;
    }
    return msg;
}

function buildErrorMessage(
    methodName: string,
    errCls: ANY_ERROR_CLS,
    registry: SchemaRegistry
): MessageObject {
    const dataSchema = errCls.schema != null
        ? registry.descOrRef((errCls.schema as GGSchema<any>).toSchemaDescription())
        : undefined;

    const props: SchemaObject['properties'] = {
        success: {type: 'boolean', enum: [false]},
        type: {type: 'string', enum: [errCls.TYPE]},
    };
    if (dataSchema) props!.data = dataSchema as SchemaObject;

    return {
        name: `${methodName} error ${errCls.TYPE}`,
        title: `${camelToTitle(methodName)} error — ${errCls.TYPE}`,
        description: `HTTP equivalent status: ${errCls.STATUS_CODE}`,
        payload: fixSchemaForAsyncApi({
            type: 'object',
            properties: props,
            required: ['success', 'type', ...(dataSchema ? ['data'] : [])]
        }) as SchemaObject,
    };
}

/** When a method has no input and no reply, describe what it means. */
function buildFireAndForgetDescription(method: {input?: unknown; success?: unknown}): string | undefined {
    if (!method.input && !method.success) return 'Keep-alive / no payload';
    return undefined;
}

// ---------------------------------------------------------------------------
// Handshake / security
// ---------------------------------------------------------------------------

function buildHandshakeOpenApi(
    middlewares: Array<{headers?: Record<string, GGSchema<string | undefined>>}>,
    securitySchemes: Map<string, SecuritySchemeObject>
): {handshakeHeaders: SchemaObject | undefined; channelSecurity: SecurityRequirementObject[]} {
    const properties: Record<string, SchemaObject> = {};
    const channelSecurity: SecurityRequirementObject[] = [];

    for (const mw of middlewares) {
        if (!mw.headers) continue;
        for (const [name, schema] of Object.entries(mw.headers)) {
            const desc = schema.toSchemaDescription();
            const format = desc.docs?.format;

            if (format === 'bearer') {
                const schemeName = desc.docs?.title ? toPascalCase(desc.docs.title) : 'BearerAuth';
                if (!securitySchemes.has(schemeName)) {
                    securitySchemes.set(schemeName, {
                        type: 'http',
                        scheme: 'bearer',
                        ...(desc.docs?.description ? {description: desc.docs.description} : {}),
                    });
                }
                channelSecurity.push({$ref: `#/components/securitySchemes/${schemeName}`} as any);
            } else {
                const s = schemaDescriptionToOpenApi(desc) as SchemaObject;
                const {description, ...rest} = s as any;
                properties[name] = {...rest, ...(description ? {description} : {})};
            }
        }
    }

    // Only emit handshakeHeaders if there are plain (non-bearer) headers
    const handshakeHeaders = Object.keys(properties).length > 0
        ? {type: 'object', properties} as SchemaObject
        : undefined;

    return {handshakeHeaders, channelSecurity};
}

// ---------------------------------------------------------------------------
// Schema post-processing for AsyncAPI 3.0 format differences
// ---------------------------------------------------------------------------

/**
 * Convert OpenAPI-format schema properties to AsyncAPI 3.0 format.
 * - discriminator: {propertyName: "x"} → "x" (plain string in AsyncAPI)
 * - additionalProperties: false → removed (not needed in message payload docs)
 */
function fixSchemaForAsyncApi(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') return schema;
    const s = schema as Record<string, unknown>;
    if ('$ref' in s) return s;

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
        if (k === 'additionalProperties' && v === false) {
            // Omit — adds noise without value in message payload documentation
            continue;
        } else if (k === 'discriminator' && v && typeof v === 'object' && 'propertyName' in (v as object)) {
            result[k] = (v as {propertyName: string}).propertyName;
        } else if (Array.isArray(v)) {
            result[k] = v.map(fixSchemaForAsyncApi);
        } else if (v && typeof v === 'object' && !('$ref' in v)) {
            result[k] = fixSchemaForAsyncApi(v);
        } else {
            result[k] = v;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sanitizeId(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

function camelToTitle(name: string): string {
    return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase())
        .trim();
}

function toPascalCase(title: string): string {
    return title
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
}
