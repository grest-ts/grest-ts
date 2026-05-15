import {IPCServer, IPCClient} from "@grest-ts/ipc";
import {GGLocatorScope} from "@grest-ts/locator";
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

        // Sub-scope with a no-op lifecycle owner so the client constructor
        // (which does setWithLifecycle on GG_DISCOVERY) doesn't throw.
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
});
