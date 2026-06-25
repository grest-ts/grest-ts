/**
 * Augments GGHttp with .ws()/.wsRaw() — the registration surface for typed and raw sockets,
 * symmetric with .http(). Lives in the websocket package (which depends on @grest-ts/http) to
 * avoid a circular dependency; reaches GGHttp's protected httpServer/middlewares via augmentation.
 */

import {GGHttp} from "@grest-ts/http"
import {GGDuplexContractDefinition, GGRawSocketContractDefinition} from "@grest-ts/schema"
import {GGWebSocketSchema} from "../schema/GGWebSocketSchema"
import {GGRawWebSocketSchema} from "../schema/GGRawWebSocketSchema"
import {GGWebSocketHandler, startWebSocketServer} from "./GGWebSocketSchema.startServer"
import {GGRawWebSocketHandler, startRawWebSocketServer} from "./GGRawWebSocketSchema.startServer"

declare module "@grest-ts/http" {
    interface GGHttp {
        ws<TDef extends GGDuplexContractDefinition>(
            schema: GGWebSocketSchema<TDef>,
            handler: GGWebSocketHandler<TDef>
        ): this
        wsRaw<TDef extends GGRawSocketContractDefinition>(
            schema: GGRawWebSocketSchema<TDef>,
            handler: GGRawWebSocketHandler<TDef>
        ): this
    }
}

GGHttp.prototype.ws = function (this: GGHttp, schema: GGWebSocketSchema<any>, handler: any): GGHttp {
    startWebSocketServer(schema, handler, {http: this.httpServer, middlewares: this.middlewares})
    return this
}

GGHttp.prototype.wsRaw = function (this: GGHttp, schema: GGRawWebSocketSchema<any>, handler: any): GGHttp {
    startRawWebSocketServer(schema, handler, {http: this.httpServer, middlewares: this.middlewares})
    return this
}
