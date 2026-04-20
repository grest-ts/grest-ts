import {GGHttpSchema} from "../schema/GGHttpSchema";
import {GGContractApiDefinition, GGContractImplementation} from "@grest-ts/schema";
import {GGHttpServerMiddleware} from "./GGHttpSchema.startServer";
import {GGHttpServer} from "./GGHttpServer";

export class GGHttp<TContext = undefined> {

    /**
     * Protected (not private) so that plugin modules can access the underlying server
     * via module augmentation (e.g. @grest-ts/openapi adds .openApi() to the builder).
     * Do not tighten back to private.
     */
    protected readonly httpServer: GGHttpServer
    private readonly middlewares: GGHttpServerMiddleware[] = [];

    constructor(httpServer: GGHttpServer) {
        this.httpServer = httpServer;
    }

    public use<M extends GGHttpServerMiddleware>(middleware: M): GGHttp<TContext | M> {
        this.middlewares.push(middleware);
        return this as any;
    }

    public http<TContract extends GGContractApiDefinition, TSchemaContext>(
        schema: GGHttpSchema<TContract, TSchemaContext>,
        implementation: GGContractImplementation<TContract>
    ): this {
        schema.register(implementation, {http: this.httpServer, middlewares: this.middlewares});
        return this as any;
    }
}
