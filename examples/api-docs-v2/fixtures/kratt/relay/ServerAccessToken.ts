import {IsObject, IsString, IsNumber} from "@grest-ts/schema"
import {IsAgentId, IsServiceName} from "../hub/schemas.js"

export const IsServerAccessTokenPayload = IsObject({
    agentId: IsAgentId,
    /** Legacy v1 naming for taskId — kept as plain string until the
     *  ServerAccessToken format is rolled forward (touches every relay
     *  TLS cert path that pins on this token shape). */
    serverId: IsString,
    permission: IsString,
    expiresAt: IsNumber,
    serviceName: IsServiceName.orUndefined,
})

export type ServerAccessTokenPayload = typeof IsServerAccessTokenPayload.infer
