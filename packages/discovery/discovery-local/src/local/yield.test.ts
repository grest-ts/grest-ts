/**
 * Yield-handover tests for the bin-supremacy protocol:
 *   - getServerInfo carries the holder's kind ("bin" | "embedded")
 *   - requestYield with no callback teardowns the holder
 *   - requestYield with a callback lets the callback own teardown
 *   - a resilient client that has ever connected to a "bin" never bids
 *     for the port again, even after that bin dies
 */
import {IPCServer, IPCClient} from "@grest-ts/ipc";
import {GGLocatorScope} from "@grest-ts/locator";
import {GGLocalDiscoveryServer} from "./GGLocalDiscoveryServer";
import {GGLocalDiscoveryResilientClient} from "./GGLocalDiscoveryResilientClient";
import {GGDiscoveryIPC} from "./GGDiscoveryIPC";

/** The IPC stack listens on port 0 to get a free one assigned, then
 *  reads it back. */
async function startServer(kind: "bin" | "embedded"): Promise<{server: GGLocalDiscoveryServer, port: number}> {
    const ipc = new IPCServer(0);
    const server = new GGLocalDiscoveryServer(ipc, kind);
    const ok = await server.start();
    if (!ok) throw new Error("IPCServer failed to bind on port 0");
    return {server, port: ipc.getPort()};
}

async function isPortFree(port: number): Promise<boolean> {
    const probe = new IPCServer(port);
    const ok = await probe.start();
    if (ok) await probe.teardown();
    return ok;
}

describe("GGLocalDiscoveryServer — yield protocol", () => {

    beforeEach(() => {
        new GGLocatorScope("YieldProtocolTest").enter();
    });

    /** Construct a resilient client inside a sub-scope that has a no-op
     *  lifecycle handler — the constructor self-registers under
     *  GG_DISCOVERY via setWithLifecycle, which throws without one. The
     *  AsyncLocalStorage scope from beforeEach doesn't carry handler
     *  state through vitest's hook→test boundary, so it's set here. */
    function makeResilient(port: number): GGLocalDiscoveryResilientClient {
        const scope = new GGLocatorScope("ResilientClientTest");
        scope.setLifecycleOwner(() => undefined);
        scope.enter();
        return new GGLocalDiscoveryResilientClient(port);
    }

    test("getServerInfo carries the holder's kind", async () => {
        const {server, port} = await startServer("bin");
        try {
            const client = new IPCClient(port);
            await client.connect();
            try {
                const info = await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.getServerInfo, undefined);
                expect(info.kind).toBe("bin");
            } finally {
                client.disconnect();
            }
        } finally {
            await server.teardown();
        }
    });

    test("requestYield with no callback tears down the server", async () => {
        const {server, port} = await startServer("embedded");
        const client = new IPCClient(port);
        await client.connect();
        try {
            await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.requestYield, undefined);
        } finally {
            client.disconnect();
        }
        // Teardown is deferred ~10ms after ack; give it a tick.
        await new Promise(r => setTimeout(r, 100));
        expect(await isPortFree(port)).toBe(true);
        // Idempotent: explicit teardown after auto-teardown should not throw.
        await server.teardown().catch((): undefined => undefined);
    });

    test("requestYield with a callback owns the teardown", async () => {
        const {server, port} = await startServer("embedded");
        let callbackFired = false;
        let portFreeAtCallback = false;
        server.onYield(async (): Promise<void> => {
            callbackFired = true;
            // The IPC server is still up at this point — the callback
            // owns the release. Verify ordering by checking the port
            // is still bound when the callback runs.
            portFreeAtCallback = await isPortFree(port);
            await server.teardown();
        });

        const client = new IPCClient(port);
        await client.connect();
        try {
            await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.requestYield, undefined);
        } finally {
            client.disconnect();
        }
        await new Promise(r => setTimeout(r, 100));
        expect(callbackFired).toBe(true);
        expect(portFreeAtCallback).toBe(false);
        expect(await isPortFree(port)).toBe(true);
    });

    test("resilient client that connected to a bin never re-bids after the bin dies", async () => {
        // Stand up a bin-kind server on a free port, get the port back.
        const {server: bin, port} = await startServer("bin");

        // Resilient client targets the bin's port. register() walks
        // becomeLeaderOrFollower → port taken → connectToLeader →
        // getServerInfo → kind=bin → seenBin=true.
        const resilient = makeResilient(port);
        await resilient.register();

        // Kill the bin. Resilient client's IPC client onClose fires,
        // becomeLeaderOrFollower runs, the seenBin guard skips the
        // leader bid, connectToLeader retries against a dead port.
        await bin.teardown();

        // Give the resilient client several event-loop turns to react.
        // 200ms is well past the onClose dispatch but well under the
        // 1s connectToLeader retry interval — even if it tried to bid,
        // it would already have done so by now.
        await new Promise(r => setTimeout(r, 200));

        // The load-bearing assertion: nobody is holding the port.
        expect(await isPortFree(port)).toBe(true);

        await resilient.unregister();
    });
});
