/**
 * Unit tests for the leader's reaction to follower lifecycle events.
 *
 * Specifically: when a registered follower disconnects abruptly (no
 * graceful unregister), its routes must be evicted. Otherwise round-
 * robin lookups will keep proposing the dead instance and produce
 * intermittent ECONNREFUSED downstream.
 */
import WebSocket from "ws";
import {INTERNAL_SOCKET_PATH, IPCServer} from "@grest-ts/ipc";
import {GGLocatorScope} from "@grest-ts/locator";
import {GGLocalDiscoveryServer} from "./GGLocalDiscoveryServer";

describe("GGLocalDiscoveryServer — disconnect handling", () => {

    let ipcServer: IPCServer;
    let discovery: GGLocalDiscoveryServer;
    let port: number;

    beforeEach(async () => {
        // testkit-vitest enters a scope at module load, but vitest hook
        // execution can land in a fresh async context that does not see it.
        // Enter our own per-test scope so IPCServer's GGLocator.getScope()
        // succeeds.
        new GGLocatorScope("DiscoveryServerTest").enter();
        ipcServer = new IPCServer(0);
        discovery = new GGLocalDiscoveryServer(ipcServer);
        await ipcServer.start();
        port = ipcServer.getPort();
    });

    afterEach(async () => {
        await ipcServer.teardown();
    });

    /** Open a raw IPC websocket. Sends register/unregister via the
     *  on-the-wire protocol so the test can violently terminate the
     *  underlying socket without going through GGLocalDiscoveryClient
     *  (which only sends unregister gracefully). */
    async function openFollower(runtimeId: string): Promise<WebSocket> {
        const ws = new WebSocket(`ws://localhost:${port}${INTERNAL_SOCKET_PATH}?runtimeId=${runtimeId}`);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        return ws;
    }

    /** IPCSocket framing: `type:id:path:dataJSON`. Send a framework
     *  request and resolve when the matching response arrives. */
    function sendFrameworkRequest(ws: WebSocket, requestId: string, path: string, data: unknown): Promise<void> {
        return new Promise((resolve, reject) => {
            const onMsg = (raw: WebSocket.RawData) => {
                const parts = raw.toString().split(":");
                if (parts[0] !== "s" || parts[1] !== requestId) return;
                ws.off("message", onMsg);
                const payload = JSON.parse(parts.slice(3).join(":"));
                payload.success ? resolve() : reject(new Error(payload.error));
            };
            ws.on("message", onMsg);
            ws.send(`r:${requestId}:${path}:${JSON.stringify(data)}`);
        });
    }

    test("violent disconnect evicts the disconnected follower's routes", async () => {
        const ws = await openFollower("violent-runtime");

        await sendFrameworkRequest(ws, "1", "discovery/register", [{
            api: "violentapi",
            baseUrl: "http://localhost:9999",
            pathPrefix: "/api/violent/",
        }]);

        expect(discovery.getRoute("violentapi")?.baseUrl).toBe("http://localhost:9999");

        const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
        // ws.terminate() drops TCP without a close frame. No unregister
        // is ever sent — this is what the leader sees when a follower
        // process is SIGKILLed.
        ws.terminate();
        await closed;
        // One extra tick so the server's onClose handler has run.
        await new Promise((r) => setTimeout(r, 50));

        expect(discovery.getRoute("violentapi")).toBeUndefined();
    });

    test("graceful unregister evicts the route (control)", async () => {
        const ws = await openFollower("graceful-runtime");

        const entry = {
            api: "gracefulapi",
            baseUrl: "http://localhost:9998",
            pathPrefix: "/api/graceful/",
        };
        await sendFrameworkRequest(ws, "1", "discovery/register", [entry]);
        expect(discovery.getRoute("gracefulapi")?.baseUrl).toBe("http://localhost:9998");

        await sendFrameworkRequest(ws, "2", "discovery/unregister", [entry]);
        ws.close();
        await new Promise((r) => setTimeout(r, 50));

        expect(discovery.getRoute("gracefulapi")).toBeUndefined();
    });

    test("disconnect of one replica leaves other replicas' routes intact", async () => {
        // Two followers register the same (api, baseUrl, pathPrefix). The
        // leader stores both — round-robin between identical replicas is
        // valid. Killing one must not also evict the other.
        const wsA = await openFollower("replica-a");
        const wsB = await openFollower("replica-b");

        const entry = {
            api: "replicaapi",
            baseUrl: "http://localhost:9001",
            pathPrefix: "/api/replica/",
        };
        await sendFrameworkRequest(wsA, "1", "discovery/register", [entry]);
        await sendFrameworkRequest(wsB, "1", "discovery/register", [entry]);

        // Both registrations stored — getRoute returns *some* instance.
        expect(discovery.getRoute("replicaapi")).toBeDefined();

        const closedA = new Promise<void>((resolve) => wsA.once("close", () => resolve()));
        wsA.terminate();
        await closedA;
        await new Promise((r) => setTimeout(r, 50));

        // After killing replica-a, replica-b's identical entry must remain.
        expect(discovery.getRoute("replicaapi")?.baseUrl).toBe("http://localhost:9001");

        wsB.close();
    });
});
