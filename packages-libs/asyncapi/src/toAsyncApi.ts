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
 * Pure function — no side effects, safe to call in CI/scripts.
 *
 * Channels map to WebSocket endpoints.
 * Operations map to clientToServer (send) and serverToClient (receive) methods.
 * Named schemas (docs.title set) are extracted to components/schemas via $ref.
 */
export function toAsyncApi(
    schemas: GGWebSocketSchema<any, any, any, any, any>[],
    options: ToAsyncApiOptions = {}
): AsyncAPIDocument {
    const registry = new SchemaRegistry();
    const channels: Record<string, ChannelObject> = {};
    const operations: Record<string, OperationObject> = {};
    const securitySchemes = new Map<string, SecuritySchemeObject>();

    for (const wsSchema of schemas) {
        const contract = wsSchema.contract;
        const channelId = sanitizeId(wsSchema.name);
        const path = wsSchema.path.startsWith('/') ? wsSchema.path : '/' + wsSchema.path;

        // Collect messages and build channel
        const messages: Record<string, MessageObject | ReferenceObject> = {};
        const channelRef: ReferenceObject = {$ref: `#/channels/${channelId}`};

        // Header schemas from middlewares (for channel binding and security)
        const {handshakeHeaders, channelSecurity} = buildHandshakeOpenApi(
            wsSchema.middlewares as any[], securitySchemes
        );

        // clientToServer methods → send operations
        const clientToServerContract = contract.clientToServer;
        for (const methodName of Object.keys(clientToServerContract.methods)) {
            const method = clientToServerContract.methods[methodName];
            const msgId = `${channelId}_${methodName}`;
            const hasResponse = 'success' in method && method.success != null;

            // Request message
            const requestMsgId = hasResponse ? `${msgId}_request` : msgId;
            messages[requestMsgId] = buildMessage(
                hasResponse ? `${methodName} request` : methodName,
                method.input ?? undefined,
                registry
            );

            const operationId = `${wsSchema.name}_send_${methodName}`;
            const operation: OperationObject = {
                action: 'send',
                channel: channelRef,
                title: camelToTitle(methodName),
                summary: hasResponse ? `${camelToTitle(methodName)} (request/response)` : `${camelToTitle(methodName)} (fire-and-forget)`,
                messages: [{$ref: `#/channels/${channelId}/messages/${requestMsgId}`}],
            };

            if (channelSecurity.length) operation.security = channelSecurity;

            // Response message
            if (hasResponse) {
                const responseMsgId = `${msgId}_response`;
                messages[responseMsgId] = buildResponseMessage(methodName, method, registry);
                operation.reply = {
                    channel: channelRef,
                    messages: [{$ref: `#/channels/${channelId}/messages/${responseMsgId}`}]
                };
            }

            operations[operationId] = operation;
        }

        // serverToClient methods → receive operations
        const serverToClientContract = contract.serverToClient;
        for (const methodName of Object.keys(serverToClientContract.methods)) {
            const method = serverToClientContract.methods[methodName];
            const msgId = `${channelId}_${methodName}`;

            messages[msgId] = buildMessage(
                methodName,
                method.input ?? undefined,
                registry
            );

            const operationId = `${wsSchema.name}_receive_${methodName}`;
            const operation: OperationObject = {
                action: 'receive',
                channel: channelRef,
                title: camelToTitle(methodName),
                summary: camelToTitle(methodName),
                messages: [{$ref: `#/channels/${channelId}/messages/${msgId}`}],
            };

            if (channelSecurity.length) operation.security = channelSecurity;
            operations[operationId] = operation;
        }

        // Channel binding — WebSocket-specific (handshake headers)
        const channel: ChannelObject = {
            address: path,
            title: wsSchema.name,
            messages,
        };

        if (handshakeHeaders && Object.keys(handshakeHeaders).length > 0) {
            channel.bindings = {ws: {method: 'GET', headers: handshakeHeaders}};
        }

        channels[channelId] = channel;
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

    if (options.servers) {
        doc.servers = options.servers;
    }

    const schemaComponents = registry.getComponents();
    const securityComponents = securitySchemes.size > 0
        ? Object.fromEntries(securitySchemes)
        : undefined;

    if (schemaComponents || securityComponents) {
        doc.components = {
            ...(schemaComponents ? {schemas: schemaComponents as Record<string, SchemaObject>} : {}),
            ...(securityComponents ? {securitySchemes: securityComponents} : {}),
        };
    }

    return doc;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMessage(
    name: string,
    inputSchema: GGSchema<any> | undefined,
    registry: SchemaRegistry
): MessageObject {
    const msg: MessageObject = {
        name,
        title: camelToTitle(name),
    };
    if (inputSchema) {
        msg.payload = registry.descOrRef(inputSchema.toSchemaDescription()) as SchemaObject;
    }
    return msg;
}

function buildResponseMessage(
    methodName: string,
    method: {success?: GGSchema<any>; errors?: ANY_ERROR_CLS[]},
    registry: SchemaRegistry
): MessageObject {
    const msg: MessageObject = {
        name: `${methodName}_response`,
        title: `${camelToTitle(methodName)} response`,
    };

    if (method.success) {
        // Wrap in the {success,type,data} envelope matching the HTTP wire format
        const dataSchema = registry.descOrRef(method.success.toSchemaDescription());
        msg.payload = {
            type: 'object',
            properties: {
                success: {type: 'boolean', enum: [true]},
                type: {type: 'string', enum: ['OK']},
                data: dataSchema as SchemaObject
            },
            required: ['success', 'type', 'data']
        };
    }
    return msg;
}

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
                const schemeName = desc.docs?.title
                    ? toPascalCase(desc.docs.title)
                    : 'BearerAuth';
                if (!securitySchemes.has(schemeName)) {
                    securitySchemes.set(schemeName, {
                        type: 'http',
                        scheme: 'bearer',
                        ...(desc.docs?.description ? {description: desc.docs.description} : {}),
                    });
                }
                channelSecurity.push({[schemeName]: []});
            } else {
                const s = schemaDescriptionToOpenApi(desc) as SchemaObject;
                const {description, ...rest} = s as any;
                properties[name] = {...rest, ...(description ? {description} : {})};
            }
        }
    }

    const handshakeHeaders = Object.keys(properties).length > 0
        ? {type: 'object', properties} as SchemaObject
        : undefined;

    return {handshakeHeaders, channelSecurity};
}

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
