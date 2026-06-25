import {GGHttpSchema} from "../schema/GGHttpSchema";
import {GGContractApiDefinition, GGContractImplementation} from "@grest-ts/schema";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGHttpServer} from "./GGHttpServer";
import {registerHttpSchema} from "./GGHttpSchema.startServer";

export class GGHttp {

    /**
     * Protected (not private) so plugin packages can reach them from `declare module`
     * augmentations (@grest-ts/openapi's .openApi(), @grest-ts/websocket's .ws()/.wsRaw()).
     * Do not tighten back to private.
     */
    protected readonly httpServer: GGHttpServer
    protected readonly middlewares: GGTransportMiddleware[] = [];

    constructor(httpServer: GGHttpServer) {
        this.httpServer = httpServer;
    }

    public use(middleware: GGTransportMiddleware): this {
        this.middlewares.push(middleware);
        return this;
    }

    public http<TContract extends GGContractApiDefinition>(
        schema: GGHttpSchema<TContract>,
        implementation: GGContractImplementation<TContract>
    ): this {
        registerHttpSchema(schema, implementation, {
            http: this.httpServer,
            middlewares: this.middlewares,
        });
        return this;
    }
}
