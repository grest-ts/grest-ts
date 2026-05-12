import {GGHttpSchema} from "../schema/GGHttpSchema";
import {GGContractApiDefinition, GGContractImplementation} from "@grest-ts/schema";
import {GGHttpServerMiddleware} from "./GGHttpSchema.startServer";
import {GGHttpServer} from "./GGHttpServer";

/**
 * Resolves the caller's permission scopes for the current request. The function
 * is called once between transport middleware and the handler. Sync or async —
 * both supported (the gate awaits).
 *
 * Return `null` when no caller identity is available (the gate will throw
 * NOT_AUTHORIZED for non-public methods). Return a (possibly empty) set
 * otherwise; the gate will call satisfies() against the method's permission.
 *
 * The resolver should read whatever app-defined context the upstream auth
 * middleware populated — it should NOT parse the token itself.
 */
export type GGScopeResolver =
    () => ReadonlySet<string> | null | Promise<ReadonlySet<string> | null>

export class GGHttp<TContext = undefined> {

    /**
     * Protected (not private) so that plugin modules can access the underlying server
     * via module augmentation (e.g. @grest-ts/openapi adds .openApi() to the builder).
     * Do not tighten back to private.
     */
    protected readonly httpServer: GGHttpServer
    private readonly middlewares: GGHttpServerMiddleware[] = [];
    private permissionResolver?: GGScopeResolver;

    constructor(httpServer: GGHttpServer) {
        this.httpServer = httpServer;
    }

    public use<M extends GGHttpServerMiddleware>(middleware: M): GGHttp<TContext | M> {
        this.middlewares.push(middleware);
        return this as any;
    }

    /**
     * Register a scope resolver. Subsequent .http(...) calls capture this
     * resolver and use it to gate every request against the contract's
     * declared `permission`.
     *
     * Calling order matters: .use(auth) → .usePermissions(getScopes) → .http(api).
     * If .http() runs before .usePermissions(), the call sees no resolver — and
     * the startup check will hard-fail if its schema has any non-public method.
     */
    public usePermissions(resolver: GGScopeResolver): this {
        this.permissionResolver = resolver;
        return this;
    }

    public http<TContract extends GGContractApiDefinition, TSchemaContext>(
        schema: GGHttpSchema<TContract, TSchemaContext>,
        implementation: GGContractImplementation<TContract>
    ): this {
        schema.register(implementation, {
            http: this.httpServer,
            middlewares: this.middlewares,
            permissionResolver: this.permissionResolver,
        });
        return this as any;
    }
}
