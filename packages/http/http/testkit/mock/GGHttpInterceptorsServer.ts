import * as http from "http";
import findMyWay, {HTTPMethod} from "find-my-way";
import {HttpRoute, IPCServer} from "@grest-ts/ipc";
import {GGLog} from "@grest-ts/logger";
import {ERROR} from "@grest-ts/schema";
import {GGInterceptorTable, GGTestComponent, GGTestRunner, GGTestRuntime, GGTestRuntimeState} from "@grest-ts/testkit";
import {GGLocalDiscoveryServer} from "@grest-ts/discovery-local";
import type {HttpMethod} from "@grest-ts/common";
import type {GGHttpSchema} from "../../src/schema/GGHttpSchema";
import {GGHttpInterceptor} from "./GGHttpSchema.mock";
import {GGHttpAddress, GGHttpTestIPC} from "./GGHttpTestAddresses";

interface GGHttpDefaultAnswer {
    apiName: string
    answer: (body: any) => Promise<unknown>
}

const WILDCARD_OR_LOOPBACK = new Set(["0.0.0.0", "::", "localhost", "127.0.0.1", "::1"]);
const REQUEST_HEADERS_NOT_FORWARDED = new Set(["host", "connection", "content-length", "transfer-encoding"]);
// fetch has already decoded the response body and re-frames it, so its original framing headers would be wrong.
const RESPONSE_HEADERS_NOT_FORWARDED = new Set(["connection", "content-length", "content-encoding", "transfer-encoding", "set-cookie"]);

/**
 * Decides every HTTP call that reaches the test router, before its body is read: one matching interceptor answers
 * (mock) or observes (spy) it, otherwise it goes to the instance discovery picks, otherwise to a default answer.
 */
export class GGHttpInterceptorsServer implements GGTestComponent {

    private readonly runner: GGTestRunner
    private readonly server: IPCServer
    private readonly discoveryServer: GGLocalDiscoveryServer;
    private readonly interceptors = new GGInterceptorTable<GGHttpInterceptor>();
    private readonly defaults: Map<string, GGHttpDefaultAnswer> = new Map();
    // Path templates (`delete/:id`) that have an interceptor or a default; the store is their key.
    private readonly templates = findMyWay<findMyWay.HTTPVersion.V1>();
    private readonly templateKeys = new Set<string>();
    private readonly addresses: Map<string, GGHttpAddress[]> = new Map();

    constructor(runner: GGTestRunner) {
        if (!(runner.discoveryServer instanceof GGLocalDiscoveryServer)) {
            throw new Error("GGHttpInterceptorsServer requires GGLocalDiscoveryServer as discovery server. This should be default for tests...");
        }
        this.runner = runner;
        this.server = runner.ipcServer;
        this.discoveryServer = runner.discoveryServer;
        this.discoveryServer.isServed = (api) => this.interceptors.some(i => i.apiName === api && !i.passThrough)
            || [...this.defaults.values()].some(d => d.apiName === api);
        this.server.setHttpResolver((req) => this.resolve(req));
        this.server.onFrameworkMessage(GGHttpTestIPC.addresses, async (addresses, msg) => {
            this.addresses.set(msg.runtimeId!, addresses);
        });
        // Ports get reused, so a gone runtime must not keep one.
        this.server.onClientDisconnect((_clientId, runtimeId) => {
            if (runtimeId) this.addresses.delete(runtimeId);
        });
    }

    public async teardown(): Promise<void> {
        this.interceptors.clear();
        this.defaults.clear();
        this.addresses.clear();
    }

    /**
     * For framework packages whose own API is called implicitly (e.g. a token endpoint): answers
     * `schema`'s methods while no runtime serves the API. A running service still gets the call, and a
     * test's own mock of the method replaces the answer while it is active.
     */
    public addDefault(schema: GGHttpSchema<any>, answers: Record<string, (body: any) => Promise<unknown>>): void {
        for (const [name, answer] of Object.entries(answers)) {
            const codec = schema.codec[name];
            const path = "/" + schema.pathPrefix + "/" + codec.path;
            const key = `${codec.method} ${path}`;
            this.defaults.set(key, {apiName: schema.name, answer});
            this.addTemplate(codec.method, path, key);
        }
    }

    public addInterceptor(interceptor: GGHttpInterceptor) {
        if (interceptor.passThrough && !this.discoveryServer.getRoute(interceptor.apiName)) {
            throw new Error(
                `Cannot add spy for '${interceptor.apiName}' - service is not running!\n` +
                `Spies require the actual service to be running so requests can be proxied.\n` +
                `Did you forget to add 'withRuntime(${interceptor.apiName.replace('Api', 'Runtime')})' to your test?`
            );
        }
        this.interceptors.add(interceptor);
        this.addTemplate(interceptor.method, interceptor.pathPrefix + interceptor.pathSuffix, interceptor.getKey());
    }

    public deleteInterceptor(interceptor: GGHttpInterceptor) {
        const key = interceptor.getKey();
        this.interceptors.delete(interceptor);
        if (this.interceptors.get(key).length === 0 && !this.defaults.has(key) && this.templateKeys.delete(key)) {
            this.templates.off(interceptor.method as HTTPMethod, interceptor.pathPrefix + interceptor.pathSuffix);
        }
    }

    private addTemplate(method: HttpMethod, path: string, key: string): void {
        if (this.templateKeys.has(key)) return;
        this.templateKeys.add(key);
        this.templates.on(method as HTTPMethod, path, () => {
        }, key);
    }

    private resolve(req: http.IncomingMessage): HttpRoute {
        const path = req.url!.split("?")[0];
        const key = this.templates.find(req.method as HTTPMethod, path)?.store as string | undefined;
        if (key === undefined) {
            return this.discoveryServer.selectInstance(path)?.baseUrl;
        }

        const candidates = this.interceptors.get(key);
        // An untargeted mock alone answers wherever the call would go, so no instance is picked and round robin doesn't advance.
        const untargetedMockOnly = candidates.length === 1 && !candidates[0].target && !candidates[0].passThrough;
        const instance = untargetedMockOnly ? undefined : this.discoveryServer.selectInstance(path);
        let runtime: GGTestRuntime | undefined;
        try {
            runtime = instance && this.runtimeAt(instance.baseUrl);
        } catch (error: any) {
            // The caller only sees a failed call, which code under test may swallow.
            candidates.forEach(candidate => candidate.routingFailed(error));
            throw error;
        }
        const where = untargetedMockOnly ? undefined : runtime?.label ?? instance?.baseUrl ?? "no running instance";
        const interceptor = this.interceptors.match(key, runtime, where);

        if (interceptor && !interceptor.passThrough) {
            return (req, res) => this.answer(req, res, `MOCKED ${interceptor.getLabel()}`, body => interceptor.onRequest(body));
        }
        if (interceptor) {
            return (req, res) => this.spy(req, res, interceptor, instance?.baseUrl);
        }
        if (instance) {
            return instance.baseUrl;
        }
        const fallback = this.defaults.get(key);
        return fallback && ((req, res) => this.answer(req, res, `DEFAULT_ANSWER [${key}]`, fallback.answer));
    }

    private runtimeAt(baseUrl: string): GGTestRuntime | undefined {
        const {hostname, port} = new URL(baseUrl);
        if (!WILDCARD_OR_LOOPBACK.has(hostname)) return undefined;
        const listening: GGTestRuntime[] = [];
        for (const [runtimeId, addresses] of this.addresses) {
            const runtime = this.runner.getRuntimeById(runtimeId);
            if (runtime?.state === GGTestRuntimeState.STARTED && addresses.some(a => a.port === Number(port) && WILDCARD_OR_LOOPBACK.has(a.host))) {
                listening.push(runtime);
            }
        }
        if (listening.length > 1) {
            throw new Error(`${baseUrl} is served by several runtimes (${listening.map(r => r.label).join(", ")}), so the call's target is ambiguous.`);
        }
        return listening[0];
    }

    private async answer(req: http.IncomingMessage, res: http.ServerResponse, what: string, reply: (body: any) => Promise<unknown>): Promise<void> {
        const body = parseJson(await readBody(req));
        GGLog.debug(this, `[${what}] request`, body);
        const data = await reply(body);
        GGLog.debug(this, `[${what}] reply`, data);
        res.writeHead(200, {"content-type": "application/json"});
        res.end(JSON.stringify(data instanceof ERROR ? data.toJSON() : {success: true, statusCode: 200, type: "OK", data}));
    }

    private async spy(req: http.IncomingMessage, res: http.ServerResponse, interceptor: GGHttpInterceptor, baseUrl: string | undefined): Promise<void> {
        const body = await readBody(req);
        GGLog.debug(this, `[SPIED ${interceptor.getLabel()}] request -> ${baseUrl}`);
        await interceptor.onRequest(parseJson(body));

        let response: Response;
        try {
            if (!baseUrl) throw new Error(`no running instance serves '${interceptor.apiName}'`);
            const abort = new AbortController();
            res.on("close", () => abort.abort());
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(req.headers)) {
                if (value !== undefined && !REQUEST_HEADERS_NOT_FORWARDED.has(name)) headers[name] = Array.isArray(value) ? value.join(", ") : value;
            }
            response = await fetch(baseUrl + req.url, {method: req.method, headers, body: body.length ? new Uint8Array(body) : undefined, redirect: "manual", signal: abort.signal});
        } catch (error: any) {
            const cause = error?.cause?.code ?? error?.cause?.message ?? error?.message;
            const issue = `Spy ${interceptor.getLabel()} could not forward the call to ${baseUrl}: ${cause} (Did the service crash?)`;
            // No response will come, so fail the spy now rather than let .waitFor() run out.
            interceptor.routingFailed(new Error(issue));
            res.writeHead(502, {"content-type": "application/json"});
            res.end(JSON.stringify({issue}));
            return;
        }
        const responseBody = Buffer.from(await response.arrayBuffer());
        await interceptor.onResponse(parseJson(responseBody));

        const headers: Record<string, string | string[]> = {};
        response.headers.forEach((value, name) => {
            if (!RESPONSE_HEADERS_NOT_FORWARDED.has(name)) headers[name] = value;
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) headers["set-cookie"] = cookies;
        res.writeHead(response.status, headers);
        res.end(responseBody);
    }
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function parseJson(body: Buffer): any {
    try {
        return body.length ? JSON.parse(body.toString()) : undefined;
    } catch {
        return undefined;
    }
}

GGTestRunner.registerExtension(GGHttpInterceptorsServer);
