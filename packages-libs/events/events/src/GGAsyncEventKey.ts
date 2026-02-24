import {GGContextKey} from "@grest-ts/context";
import {IsObject, IsString} from "@grest-ts/schema";

const IsAsyncEventContext = IsObject({
    eventType: IsString,
    source: IsString
});
export type AsyncEventContext = typeof IsAsyncEventContext.infer;

export const GG_ASYNC_EVENT = new GGContextKey<AsyncEventContext>('async-event', IsAsyncEventContext);
