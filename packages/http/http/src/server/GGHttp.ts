import {GGHttpSchema} from "../schema/GGHttpSchema";
import {GGContractApiDefinition, GGContractImplementation} from "@grest-ts/schema";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {GGHttpServer} from "./GGHttpServer";
import {registerHttpSchema} from "./GGHttpSchema.startServer";

export class GGHttp {

    /**
     * Protected (not private) so that plugin modules can access the underlying server
     * via module augmentation (e.g. @grest-ts/openapi adds .openApi() to the builder).
     * Do not tighten back to private.
     */
    protected readonly httpServer: GGHttpServer
    private readonly middlewares: GGTransportMiddleware[] = [];

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

    /**
     * @internal Hook the websocket package uses to implement .ws()/.wsRaw() via module
     * augmentation — it needs the server and accumulated middlewares without exposing them.
     */
    public _bind(register: (server: GGHttpServer, middlewares: readonly GGTransportMiddleware[]) => void): this {
        register(this.httpServer, this.middlewares);
        return this;
    }
}
