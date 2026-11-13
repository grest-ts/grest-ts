import * as http from "http";
import {isIPv4} from "net";
import findMyWay, {HTTPMethod} from "find-my-way";
import {HttpRoute, IPCServer} from "@grest-ts/ipc";
import {GGLog} from "@grest-ts/logger";
import {ERROR, GGContractMethod} from "@grest-ts/schema";
import {Readable} from "stream";
import type {GGConnectionSettings} from "@grest-ts/context";
import {GGInterceptorTable, GGTestComponent, GGTestRunner, GGTestRuntime, GGTestRuntimeState, GGTestTarget} from "@grest-ts/testkit";
import {GGLocalDiscoveryServer} from "@grest-ts/discovery-local";
import type {HttpMethod} from "@grest-ts/common";
import type {GGHttpCodec, GGHttpSchema} from "../../src/schema/GGHttpSchema";
import {GGHttpInterceptor} from "./GGHttpSchema.mock";
import {GGHttpAddress, GGHttpTestIPC} from "./GGHttpTestAddresses";
import {decodeDestination, DESTINATION_HEADER} from "./GGHttpTestTransport";
import {invalidateTlsAgent, nodeDefaultTransport} from "../../src/client/nodeConnectionTransport.node.js";
import type {GGHttpTransport} from "../../src/client/GGHttpSchema.createClient";

interface GGHttpDefaultAnswer {
    apiName: string
    route: GGHttpRoute
    answer: (input: any) => Promise<unknown>
}

/** What reading a call's input takes: the route's codec and its contract method. */
export interface GGHttpRoute {
    codec: GGHttpCodec
    contract: GGContractMethod
}

/** Where a call goes: the instance discovery picked, or what an addressed client carried. */
interface Destination extends GGHttpAddress {
    /** What the request path is appended to; with a settings host the transport dials that host instead. */
    baseUrl: string
    settings?: GGConnectionSettings
    label: string
    /** Dialled by the router itself; a discovery call with no interceptor is proxied instead. */
    addressed: boolean
}

const WILDCARD = new Set(["0.0.0.0", "::"]);
const REQUEST_HEADERS_NOT_FORWARDED = new Set(["host", "connection", "content-length", "transfer-encoding", DESTINATION_HEADER]);
// fetch has already decoded the response body and re-frames it, so its original framing headers would be wrong.
const RESPONSE_HEADERS_NOT_FORWARDED = new Set(["connection", "content-length", "content-encoding", "transfer-encoding", "set-cookie"]);

/**
 * Decides every HTTP call that reaches the test router, before its body is read: one matching interceptor answers
 * (mock) or observes (spy) it, otherwise it goes to its destination (the instance discovery picks, or the address
 * the client carried), otherwise to a default answer.
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
    public addDefault(schema: GGHttpSchema<any>, answers: Record<string, (input: any) => Promise<unknown>>): void {
        for (const [name, answer] of Object.entries(answers)) {
            const codec = schema.codec[name];
            const path = "/" + schema.pathPrefix + "/" + codec.path;
            const key = `${codec.method} ${path}`;
            this.defaults.set(key, {apiName: schema.name, route: {codec, contract: schema.contract.methods[name]}, answer});
            this.addTemplate(codec.method, path, key);
        }
    }

    public addInterceptor(interceptor: GGHttpInterceptor) {
        // A spy on an address says something listens there; any other spy needs a service running in the test.
        if (interceptor.passThrough && !(interceptor.target instanceof GGTestTarget) && !this.discoveryServer.getRoute(interceptor.apiName)) {
            throw new Error(
                `Cannot add spy for '${interceptor.apiName}' - service is not running!\n` +
                `A spy forwards the call, so a runtime that serves the API must run in the test.\n` +
                `If the client addresses the call itself (a fixed url or a connection-settings host), name the address: .on(GGTest.target("host:port")).`
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
        // Only a test runtime on this machine may name a destination: the router would dial it, with the client certificate it carries.
        const carried = isLoopback(req.socket.remoteAddress ?? "") ? req.headers[DESTINATION_HEADER] as string | undefined : undefined;
        const key = this.templates.find(req.method as HTTPMethod, path)?.store as string | undefined;
        if (key === undefined) {
            const destination = this.destinationOf(carried, path);
            return destination?.addressed ? (req, res) => this.forward(req, res, destination) : destination?.baseUrl;
        }

        const candidates = this.interceptors.get(key);
        // An untargeted mock alone answers wherever the call would go, so no instance is picked and round robin doesn't advance.
        const untargetedMockOnly = candidates.length === 1 && !candidates[0].target && !candidates[0].passThrough;
        let destination: Destination | undefined;
        let runtime: GGTestRuntime | undefined;
        try {
            destination = untargetedMockOnly ? undefined : this.destinationOf(carried, path);
            runtime = destination && this.runtimeAt(destination);
        } catch (error: any) {
            // The caller only sees a failed call, which code under test may swallow.
            candidates.forEach(candidate => candidate.routingFailed(error));
            throw error;
        }
        const where = untargetedMockOnly ? undefined : runtime?.label ?? destination?.label ?? "no running instance";
        const interceptor = this.interceptors.match(key, destination && (target =>
            target instanceof GGTestTarget ? target.port === destination!.port && sameHost(target.host, destination!.host) : target === runtime
        ), where);

        if (interceptor && !interceptor.passThrough) {
            return (req, res) => this.answer(req, res, `MOCKED ${interceptor.getLabel()}`, interceptor.route, input => interceptor.onRequest(input));
        }
        if (interceptor || destination?.addressed) {
            return (req, res) => this.forward(req, res, destination, interceptor);
        }
        if (destination) {
            return destination.baseUrl;
        }
        const fallback = this.defaults.get(key);
        return fallback && ((req, res) => this.answer(req, res, `DEFAULT_ANSWER [${key}]`, fallback.route, fallback.answer));
    }

    private destinationOf(carried: string | undefined, path: string): Destination | undefined {
        if (carried === undefined) {
            const baseUrl = this.discoveryServer.selectInstance(path)?.baseUrl;
            return baseUrl === undefined ? undefined : {baseUrl, label: baseUrl, ...addressOf(baseUrl), addressed: false};
        }
        const {url, settings} = decodeDestination(carried);
        // As the node transport dials: a settings host replaces the URL's, over https.
        const address = settings?.host ? {host: canonicalHost(settings.host), port: settings.port ?? 443} : addressOf(url);
        return {baseUrl: url, settings, label: settings?.host ? `${address.host}:${address.port}` : url, ...address, addressed: true};
    }

    /** A bind to that very host wins over a wildcard bind, which only stands for this machine's loopback hosts. */
    private runtimeAt(destination: GGHttpAddress): GGTestRuntime | undefined {
        const specific: GGTestRuntime[] = [];
        const wildcard: GGTestRuntime[] = [];
        for (const [runtimeId, addresses] of this.addresses) {
            const runtime = this.runner.getRuntimeById(runtimeId);
            if (runtime?.state !== GGTestRuntimeState.STARTED) continue;
            const onPort = addresses.filter(a => a.port === destination.port);
            if (onPort.some(a => sameHost(a.host, destination.host))) {
                specific.push(runtime);
            } else if (isLoopback(destination.host) && onPort.some(a => WILDCARD.has(a.host))) {
                wildcard.push(runtime);
            }
        }
        const listening = specific.length ? specific : wildcard;
        if (listening.length > 1) {
            throw new Error(`${destination.host}:${destination.port} is served by several runtimes (${listening.map(r => r.label).join(", ")}), so the call's target is ambiguous.`);
        }
        return listening[0];
    }

    private async answer(req: http.IncomingMessage, res: http.ServerResponse, what: string, route: GGHttpRoute, reply: (input: any) => Promise<unknown>): Promise<void> {
        const body = await readInput(route, req, await readBody(req));
        GGLog.debug(this, `[${what}] request`, body);
        const data = await reply(body);
        GGLog.debug(this, `[${what}] reply`, data);
        res.writeHead(200, {"content-type": "application/json"});
        res.end(JSON.stringify(data instanceof ERROR ? data.toJSON() : {success: true, statusCode: 200, type: "OK", data}));
    }

    /** Dials the destination as the client would have, and returns what came back unchanged; a spy sees both sides. */
    private async forward(req: http.IncomingMessage, res: http.ServerResponse, destination: Destination | undefined, spy?: GGHttpInterceptor): Promise<void> {
        const body = await readBody(req);
        GGLog.debug(this, `[FORWARDED${spy ? " SPIED " + spy.getLabel() : ""}] ${req.method} ${req.url} -> ${destination?.label}`);
        if (spy) await spy.onRequest(await readInput(spy.route, req, body));

        let response: Response;
        let responseBody: Buffer;
        try {
            if (!destination) throw new Error(`no running instance serves '${spy?.apiName}'`);
            const abort = new AbortController();
            res.on("close", () => abort.abort());
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(req.headers)) {
                if (value !== undefined && !REQUEST_HEADERS_NOT_FORWARDED.has(name)) headers[name] = Array.isArray(value) ? value.join(", ") : value;
            }
            response = await dial(destination.baseUrl + req.url, {
                method: req.method!,
                headers,
                body: body.length ? new Uint8Array(body) : undefined,
                signal: abort.signal,
                path: req.url!,
                connectionSettings: destination.settings,
                redirect: "manual",
            });
            responseBody = Buffer.from(await response.arrayBuffer());
        } catch (error: any) {
            const cause = error?.cause?.code ?? error?.cause?.message ?? error?.message;
            const issue = `Test router could not forward ${req.method} ${req.url} to ${destination?.label}: ${cause} (Is the target running?)`;
            // No response will come, so fail the spy now rather than let .waitFor() run out.
            spy?.routingFailed(new Error(issue));
            res.writeHead(502, {"content-type": "application/json"});
            res.end(JSON.stringify({issue}));
            return;
        } finally {
            // The caller may have dropped its connections to a restarted target; the router must not keep its own.
            if (destination?.settings) invalidateTlsAgent(destination.settings);
        }
        await spy?.onResponse(parseJson(responseBody));

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

// The node transport hands its init to fetch as it is; a forwarded call needs two things createClient never sends.
const dial = nodeDefaultTransport as (
    url: string,
    init: Omit<Parameters<GGHttpTransport>[1], "body"> & {body: Uint8Array | undefined, redirect: "manual"}
) => Promise<Response>;

function addressOf(url: string): GGHttpAddress {
    const {hostname, port, protocol} = new URL(url);
    return {host: canonicalHost(hostname), port: port ? Number(port) : protocol === "https:" ? 443 : 80};
}

function canonicalHost(host: string): string {
    return host.replace(/^\[|]$/g, "").toLowerCase();
}

function isLoopback(host: string): boolean {
    const ip = host.replace(/^::ffff:/, "");
    return host === "localhost" || host === "::1" || (isIPv4(ip) && ip.startsWith("127."));
}

/** `localhost`, `127.0.0.1` and `::1` are one host; `127.0.0.2` is another. */
function sameHost(a: string, b: string): boolean {
    const one = (host: string) => host === "localhost" || host === "::1" ? "127.0.0.1" : host;
    return one(canonicalHost(a)) === one(canonicalHost(b));
}

/** The input the server would see: the route's own codec reads path, query and body, then the contract parses it. */
async function readInput(route: GGHttpRoute, req: http.IncomingMessage, body: Buffer): Promise<unknown> {
    const parser = route.codec.createForServer({contract: route.contract, middlewares: []});
    const replay = Object.assign(Readable.from(body.length ? [body] : []), {url: req.url, method: req.method, headers: req.headers});
    let raw: unknown;
    try {
        raw = await parser.readRequest(replay as unknown as http.IncomingMessage);
    } catch {
        // A body the server would refuse (bad JSON, too large) still reaches a mock, and a spy still forwards it.
        return parseJson(body);
    }
    try {
        return parser.validateInput(raw);
    } catch {
        return raw;
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
