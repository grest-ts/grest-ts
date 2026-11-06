import type http from "http";
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

/** What a handler sees of the request it serves: for a route registered on the server directly (not through a
 *  schema) to set too. */
export function httpRequestContext(req: http.IncomingMessage, port: number): HttpRequestContext {
    return {port, method: req.method ?? "", path: req.url ?? "", pathTemplate: undefined, ...requestPeer(req)};
}

/** Who sent the request: shared by GG_HTTP_REQUEST and a websocket upgrade's connection context. */
export function requestPeer(req: http.IncomingMessage): Pick<HttpRequestContext, "peerAddress" | "userAgent" | "forwardedFor"> {
    const header = (name: string) => {
        const value = req.headers[name];
        return typeof value === "string" && value !== "" ? value : undefined;
    };
    return {peerAddress: req.socket?.remoteAddress, userAgent: header("user-agent"), forwardedFor: header("x-forwarded-for")};
}
