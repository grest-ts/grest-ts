import {GGContextKey} from "@grest-ts/context";
import {IsNumber, IsObject, IsString} from "@grest-ts/schema";

const IsWsConnectionContext = IsObject({
    port: IsNumber.orUndefined,
    path: IsString
});
export type WsConnectionContext = typeof IsWsConnectionContext.infer;

export const GG_WS_CONNECTION = new GGContextKey<WsConnectionContext>('ws-connection', IsWsConnectionContext);
