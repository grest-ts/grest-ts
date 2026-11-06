import {GGContextKey} from "@grest-ts/context";
import {IsNumber, IsObject, IsString} from "@grest-ts/schema";

const IsWsConnectionContext = IsObject({
    port: IsNumber.orUndefined,
    path: IsString,
    peerAddress: IsString.orUndefined.docs({description: "The upgrade connection's remote address as the OS reports it (a proxy's, behind one)"}),
    userAgent: IsString.orUndefined,
    forwardedFor: IsString.orUndefined.docs({description: "The upgrade request's raw `X-Forwarded-For` header. Which hop to trust is the deployment's call"}),
});
export type WsConnectionContext = typeof IsWsConnectionContext.infer;

export const GG_WS_CONNECTION = new GGContextKey<WsConnectionContext>('ws-connection', IsWsConnectionContext);
