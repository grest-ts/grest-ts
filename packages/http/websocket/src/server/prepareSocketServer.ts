import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGHttpServer, GGHttpPermissionsChecker} from "@grest-ts/http";
import {GG_NO_PERMISSIONS, GGContractMethod, GGPermission} from "@grest-ts/schema";
import type {GGServerHeartbeatOption} from "./GGSocketServer";

export interface SocketServerConfig {
    http: GGHttpServer;
    middlewares?: GGTransportMiddleware[];
    heartbeat?: GGServerHeartbeatOption;
}

interface SocketSchemaLike {
    name: string;
    path: string;
    middlewares: readonly GGTransportMiddleware[];
    contract: {connect: {method: GGContractMethod}};
}

export interface PreparedSocketServer {
    schemaName: string;
    normalizedPath: string;
    middlewares: GGTransportMiddleware[];
    permissionsChecker: GGHttpPermissionsChecker;
    connectPermission: GGPermission;
    queryValidator: GGContractMethod["input"];
}

/**
 * Shared handshake setup for typed and raw socket servers: registers the schema, builds the
 * middleware pipeline, and appends the connect-permission gate so a failed permission (or a
 * throwing resolver) rejects the handshake before the socket opens.
 */
export function prepareSocketServer(schema: SocketSchemaLike, config: SocketServerConfig): PreparedSocketServer {
    const schemaName = schema.name;
    const normalizedPath = schema.path.startsWith('/') ? schema.path : '/' + schema.path;
    config.http._registerWebSocketSchema(schema as any);

    const connectMethod = schema.contract.connect.method;
    const connectPermission = connectMethod.permission ?? GG_NO_PERMISSIONS;
    const permissionsChecker = new GGHttpPermissionsChecker(schema.middlewares);

    const middlewares: GGTransportMiddleware[] = [...schema.middlewares, ...(config.middlewares ?? [])];
    middlewares.push({
        async process() {
            await permissionsChecker.assert(schemaName, "", connectPermission);
        },
    });

    return {schemaName, normalizedPath, middlewares, permissionsChecker, connectPermission, queryValidator: connectMethod.input};
}
