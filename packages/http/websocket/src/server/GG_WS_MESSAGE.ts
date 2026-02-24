import {GGContextKey} from "@grest-ts/context";
import {IsObject, IsString} from "@grest-ts/schema";

const IsWsMessageContext = IsObject({
    path: IsString
});
export type WsMessageContext = typeof IsWsMessageContext.infer;

export const GG_WS_MESSAGE = new GGContextKey<WsMessageContext>('ws-message', IsWsMessageContext);
