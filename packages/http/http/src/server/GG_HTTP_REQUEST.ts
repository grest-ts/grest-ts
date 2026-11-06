import {GGContextKey} from "@grest-ts/context";
import {IsNumber, IsObject, IsString} from "@grest-ts/schema";

const IsHttpRequestContext = IsObject({
    port: IsNumber,
    method: IsString,
    path: IsString,
    pathTemplate: IsString.orUndefined,
    peerAddress: IsString.orUndefined.docs({description: "The connection's remote address as the OS reports it (a proxy's, behind one)"}),
    userAgent: IsString.orUndefined,
    forwardedFor: IsString.orUndefined.docs({description: "The raw `X-Forwarded-For` header. Which hop to trust is the deployment's call: clients can prepend anything"}),
});
export type HttpRequestContext = typeof IsHttpRequestContext.infer;

export const GG_HTTP_REQUEST = new GGContextKey<HttpRequestContext>('http-request', IsHttpRequestContext);
