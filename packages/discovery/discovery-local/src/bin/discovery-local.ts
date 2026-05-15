#!/usr/bin/env -S npx tsx
/**
 * Standalone launcher for the local discovery router — the IPC reverse
 * proxy that runtimes register their routes with and discover each
 * other through.
 *
 * Normally a runtime auto-sets-up discovery itself: with no embedded
 * discovery configured it spins up a `GGLocalDiscoveryResilientClient`
 * and competes for the router port (leader-elected, see
 * `GGLocalDiscoveryResilientClient`). That's the right default for
 * ad-hoc local dev. When you'd rather run the router as its own
 * process — clean ownership, its own logs, up before any runtime —
 * launch it with this bin and point runtimes at it as plain
 * `GGLocalDiscoveryClient`s.
 *
 *   npx @grest-ts/discovery-local --port 9000
 *
 * The bin is *authoritative*: if the port is already held (by a
 * runtime that leader-elected, or by another bin), it sends a
 * `requestYield` over the IPC protocol and retries until it wins.
 * Resilient clients that ever connect to a bin lock out their own
 * leader bids for the rest of their lifetime — so once the bin is in
 * the picture, in-runtime servers stay out of the way.
 */
import {GGLog} from "@grest-ts/logger";
import {GGLocatorScope} from "@grest-ts/locator";
import {IPCServer, IPCClient} from "@grest-ts/ipc";
import {GGLocalDiscoveryServer} from "../local/GGLocalDiscoveryServer";
import {GGDiscoveryIPC} from "../local/GGDiscoveryIPC";

/** How long the bin keeps retrying bind after demanding yield, before
 *  giving up. 100 attempts × 50ms = ~5s of clobber time. */
const MAX_BIND_ATTEMPTS = 100;
const RETRY_INTERVAL_MS = 50;

function parsePort(argv: string[]): number {
    const i = argv.indexOf("--port");
    const raw = i >= 0 ? argv[i + 1] : undefined;
    const port = raw === undefined ? 9000 : Number(raw);
    if (!Number.isInteger(port) || port <= 0) {
        GGLog.error("discovery-local", `Invalid --port: ${raw}`);
        process.exit(1);
    }
    return port;
}

/** Try once. On EADDRINUSE, dial the holder and ask it to yield —
 *  return false so the caller retries the bind. */
async function tryAcquire(port: number): Promise<GGLocalDiscoveryServer | undefined> {
    const router = new GGLocalDiscoveryServer(new IPCServer(port), "bin");
    if (await router.start()) return router;

    const client = new IPCClient(port);
    try {
        await client.connect();
        await client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.requestYield, undefined);
    } catch (err: any) {
        // Holder may have already torn down by the time we dialed —
        // fine, the next bind attempt will pick up the freed port.
        GGLog.debug("discovery-local", `requestYield failed (holder may be gone): ${err?.message}`);
    } finally {
        try { client.disconnect(); } catch { /* tolerated */ }
    }
    return undefined;
}

async function main(): Promise<void> {
    const port = parsePort(process.argv.slice(2));

    let router: GGLocalDiscoveryServer | undefined;
    for (let attempt = 0; attempt < MAX_BIND_ATTEMPTS; attempt++) {
        router = await tryAcquire(port);
        if (router) break;
        await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
    }
    if (!router) {
        GGLog.error("discovery-local", `Could not bind port ${port} after ${MAX_BIND_ATTEMPTS} attempts`);
        process.exit(1);
    }
    GGLog.info("discovery-local", `Discovery router listening on port ${port}`);

    const shutdown = () => {
        router!.teardown().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

// IPCServer and the discovery server register lifecycle entries in the
// locator, so the whole thing has to run inside a GGLocatorScope — the
// same scope a GGRuntime would set up around compose().
const scope = new GGLocatorScope("discovery-local", undefined, "discovery-local");
scope.run(main).catch((err) => {
    GGLog.error("discovery-local", err);
    process.exit(1);
});
