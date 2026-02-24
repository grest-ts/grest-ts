import {GGContextKey} from "@grest-ts/context";
import {IsNumber, IsObject, IsString} from "@grest-ts/schema";

const IsHttpRequestContext = IsObject({
    port: IsNumber,
    method: IsString,
    path: IsString,
    pathTemplate: IsString.orUndefined
});
export type HttpRequestContext = typeof IsHttpRequestContext.infer;

export const GG_HTTP_REQUEST = new GGContextKey<HttpRequestContext>('http-request', IsHttpRequestContext);
