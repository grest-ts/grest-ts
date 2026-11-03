import {IPCServer, IPCClient} from "@grest-ts/ipc";
import {GGLocatorScope} from "@grest-ts/locator";
import {sleep} from "@grest-ts/common";
import {GGLocalDiscoveryServer} from "./GGLocalDiscoveryServer";
import {GGLocalDiscoveryResilientClient} from "./GGLocalDiscoveryResilientClient";
import {GGDiscoveryIPC, DiscoveryServerKind} from "./GGDiscoveryIPC";

async function startServer(kind: DiscoveryServerKind): Promise<{server: GGLocalDiscoveryServer, port: number}> {
    const ipc = new IPCServer(0);
    const server = new GGLocalDiscoveryServer(ipc, kind);
    if (!(await server.start())) throw new Error("bind failed");
    return {server, port: ipc.getPort()};
}

async function isPortFree(port: number): Promise<boolean> {
    const probe = new IPCServer(port);
    const ok = await probe.start();
    if (ok) await probe.teardown();
    return ok;
}

async function freePort(): Promise<number> {
    const probe = new IPCServer(0);
    await probe.start();
    const port = probe.getPort();
    await probe.teardown();
    return port;
}

describe("yield protocol", () => {

    beforeEach(() => {
        new GGLocatorScope("YieldProtocolTest").enter();
    });

    test("getServerInfo returns kind; requestYield without onYield tears down", async () => {
        const {server, port} = await startServer(DiscoveryServerKind.Bin);
        const client = new IPCClient(port);
        await client.connect();
        const info = await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.getServerInfo, undefined);
        expect(info.kind).toBe(DiscoveryServerKind.Bin);
        await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.requestYield, undefined);
        client.disconnect();
        await new Promise(r => setTimeout(r, 100));
        expect(await isPortFree(port)).toBe(true);
        await server.teardown().catch((): undefined => undefined);
    });

    test("requestYield invokes onYield after teardown", async () => {
        const {server, port} = await startServer(DiscoveryServerKind.Embedded);
        let firedAfterTeardown = false;
        server.onYield = async () => { firedAfterTeardown = await isPortFree(port); };
        const client = new IPCClient(port);
        await client.connect();
        await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.requestYield, undefined);
        client.disconnect();
        await new Promise(r => setTimeout(r, 100));
        expect(firedAfterTeardown).toBe(true);
        expect(await isPortFree(port)).toBe(true);
    });

    test("resilient client that connected to a bin never re-bids after the bin dies", async () => {
        const {server: bin, port} = await startServer(DiscoveryServerKind.Bin);

        const subscope = new GGLocatorScope("ResilientClientTest");
        subscope.setLifecycleOwner(() => undefined);
        subscope.enter();
        const resilient = new GGLocalDiscoveryResilientClient(port);
        await resilient.register();

        await bin.teardown();
        await new Promise(r => setTimeout(r, 200));

        expect(await isPortFree(port)).toBe(true);
        await resilient.unregister();
    });

    test("embedded leader registers in-process, so yielding to a bin can't cut its register off", async () => {
        const port = await freePort();

        const subscope = new GGLocatorScope("LeaderRegisterTest");
        subscope.setLifecycleOwner(() => undefined);
        subscope.enter();
        const resilient = new GGLocalDiscoveryResilientClient(port);
        resilient.registerRoutes([{runtime: "test", api: "myapi", protocol: "http", port: 1234, pathPrefix: "/api/my/"}]);
        await resilient.register();

        // No IPC round trip to our own router, which a yield could close mid-request.
        const internals = resilient as unknown as {client: IPCClient, discoveryServer?: GGLocalDiscoveryServer};
        expect(internals.discoveryServer?.getRoute("myapi")?.baseUrl).toBe("http://localhost:1234");
        expect(await resilient.discoverApi("myapi")).toBe(`http://localhost:${port}`);
        expect(internals.client.isConnected()).toBe(false);

        const asker = new IPCClient(port);
        await asker.connect();
        await asker.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.requestYield, undefined);
        asker.disconnect();

        for (let i = 0; i < 40 && !(await isPortFree(port)); i++) await sleep(50, "wait for router to release the port");
        const bin = new GGLocalDiscoveryServer(new IPCServer(port), DiscoveryServerKind.Bin);
        try {
            expect(await bin.start()).toBe(true);
            for (let i = 0; i < 40 && !bin.getRoute("myapi"); i++) await sleep(100, "wait for handover to re-publish");
            expect(bin.getRoute("myapi")?.baseUrl).toBe("http://localhost:1234");
        } finally {
            await resilient.unregister();
            await bin.teardown();
        }
    });

    test("follower publishes its routes once on connect, with no second register request a yield could cut off", async () => {
        const {server: leader, port} = await startServer(DiscoveryServerKind.Embedded);
        const ipc = (leader as unknown as {server: IPCServer}).server;
        let registers = 0;
        ipc.onFrameworkMessage(GGDiscoveryIPC.discoveryServer.register, async (routes) => {
            registers++;
            routes.forEach(route => leader.addRoute(route));
        });

        const subscope = new GGLocatorScope("FollowerRegisterTest");
        subscope.setLifecycleOwner(() => undefined);
        subscope.enter();
        const resilient = new GGLocalDiscoveryResilientClient(port);
        resilient.registerRoutes([{runtime: "test", api: "myapi", protocol: "http", port: 1234, pathPrefix: "/api/my/"}]);
        try {
            await resilient.register();
            expect(registers).toBe(1);
            expect(leader.getRoute("myapi")?.baseUrl).toBe("http://localhost:1234");
        } finally {
            await resilient.unregister();
            await leader.teardown();
        }
    });

    test("follower that takes over from a dead embedded leader carries its own routes", async () => {
        const port = await freePort();

        const scopeA = new GGLocatorScope("DeadLeaderA");
        scopeA.setLifecycleOwner(() => undefined);
        scopeA.enter();
        const a = new GGLocalDiscoveryResilientClient(port);
        a.registerRoutes([{runtime: "a", api: "a-api", protocol: "http", port: 1111, pathPrefix: "/api/a/"}]);
        await a.register();

        const scopeB = new GGLocatorScope("DeadLeaderB");
        scopeB.setLifecycleOwner(() => undefined);
        scopeB.enter();
        const b = new GGLocalDiscoveryResilientClient(port);
        b.registerRoutes([{runtime: "b", api: "b-api", protocol: "http", port: 2222, pathPrefix: "/api/b/"}]);
        await b.register();

        const bRouter = () => (b as unknown as {discoveryServer?: GGLocalDiscoveryServer}).discoveryServer;
        expect(bRouter()).toBeUndefined();

        try {
            await a.unregister();
            for (let i = 0; i < 40 && !bRouter(); i++) await sleep(50, "wait for follower to take over");
            expect(bRouter()?.getRoute("b-api")?.baseUrl).toBe("http://localhost:2222");
        } finally {
            await b.unregister();
        }
    });

    test("addRoute dedups (same clientId, same api) on re-register", async () => {
        const {server, port} = await startServer(DiscoveryServerKind.Embedded);
        try {
            const client = new IPCClient(port);
            await client.connect();
            const entry = {api: "myapi", baseUrl: "http://localhost:1111", pathPrefix: "/api/my/"};
            await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.register, [entry]);
            await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.register, [entry]);
            await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.register, [entry]);
            // Internal: same clientId + api should appear exactly once.
            expect(server.getRoute("myapi")?.baseUrl).toBe("http://localhost:1111");
            const internalRoutes = (server as unknown as {routes: Map<string, unknown[]>}).routes.get("myapi");
            expect(internalRoutes?.length).toBe(1);
            client.disconnect();
        } finally {
            await server.teardown();
        }
    });

    test("addRoute keeps entries from different clients (legitimate replicas)", async () => {
        const {server, port} = await startServer(DiscoveryServerKind.Embedded);
        try {
            const a = new IPCClient(port);
            const b = new IPCClient(port);
            await a.connect("replica-a");
            await b.connect("replica-b");
            await a.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.register, [{api: "rep", baseUrl: "http://localhost:2001", pathPrefix: "/api/rep/"}]);
            await b.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.register, [{api: "rep", baseUrl: "http://localhost:2002", pathPrefix: "/api/rep/"}]);
            const internalRoutes = (server as unknown as {routes: Map<string, Array<{baseUrl: string}>>}).routes.get("rep");
            expect(internalRoutes?.length).toBe(2);
            expect(new Set(internalRoutes!.map(r => r.baseUrl))).toEqual(new Set(["http://localhost:2001", "http://localhost:2002"]));
            a.disconnect();
            b.disconnect();
        } finally {
            await server.teardown();
        }
    });

    test("resilient follower re-publishes its entries on a new leader after the old one dies", async () => {
        const {server: leader1, port} = await startServer(DiscoveryServerKind.Bin);

        const subscope = new GGLocatorScope("ResilientReregisterTest");
        subscope.setLifecycleOwner(() => undefined);
        subscope.enter();
        const resilient = new GGLocalDiscoveryResilientClient(port);
        resilient.registerRoutes([{runtime: "test", api: "myapi", protocol: "http", port: 1234, pathPrefix: "/api/my/"}]);
        await resilient.register();
        // Sanity: route is on leader1.
        expect(leader1.getRoute("myapi")?.baseUrl).toBe("http://localhost:1234");

        await leader1.teardown();
        // New leader on the SAME port (also a "bin" so the resilient stays loyal).
        const ipc2 = new IPCServer(port);
        const leader2 = new GGLocalDiscoveryServer(ipc2, DiscoveryServerKind.Bin);
        if (!(await leader2.start())) throw new Error("leader2 bind failed");
        try {
            // Wait long enough for resilient's onClose (1s retry) to trigger
            // a fresh connectToLeader → re-register.
            for (let i = 0; i < 20 && !leader2.getRoute("myapi"); i++) {
                await new Promise(r => setTimeout(r, 200));
            }
            expect(leader2.getRoute("myapi")?.baseUrl).toBe("http://localhost:1234");
        } finally {
            await resilient.unregister();
            await leader2.teardown();
        }
    });
});
