#!/usr/bin/env -S npx tsx
/**
 * Standalone launcher for the local discovery router. The bin is
 * authoritative: on EADDRINUSE it sends `requestYield` to the holder
 * and retries the bind. Resilient clients that ever connect to a bin
 * lock out their own leader bids for the rest of their lifetime.
 *
 *   npx @grest-ts/discovery-local --port 9000
 */
import {GGLog} from "@grest-ts/logger";
import {GGLocatorScope} from "@grest-ts/locator";
import {IPCServer, IPCClient} from "@grest-ts/ipc";
import {GGLocalDiscoveryServer} from "../local/GGLocalDiscoveryServer";
import {GGDiscoveryIPC} from "../local/GGDiscoveryIPC";
import {getLocalDiscoveryPort} from "../local/GGLocalDiscoveryClient";

function parsePort(argv: string[]): number {
    const i = argv.indexOf("--port");
    const raw = i >= 0 ? argv[i + 1] : undefined;
    const port = raw === undefined ? getLocalDiscoveryPort() : Number(raw);
    if (!Number.isInteger(port) || port <= 0) {
        GGLog.error("discovery-local", `Invalid --port: ${raw}`);
        process.exit(1);
    }
    return port;
}

async function main(): Promise<void> {
    const port = parsePort(process.argv.slice(2));

    let router: GGLocalDiscoveryServer | undefined;
    for (let i = 0; i < 100; i++) {
        const candidate = new GGLocalDiscoveryServer(new IPCServer(port), "bin");
        if (await candidate.start()) { router = candidate; break; }
        const c = new IPCClient(port);
        try { await c.connect(); await c.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.requestYield, undefined); } catch { /* holder may have already gone */ }
        try { c.disconnect(); } catch { /* tolerated */ }
        await new Promise(r => setTimeout(r, 50));
    }
    if (!router) {
        GGLog.error("discovery-local", `Could not bind port ${port} after 100 attempts`);
        process.exit(1);
    }
    GGLog.info("discovery-local", `Discovery router listening on port ${port}`);

    const shutdown = () => { router!.teardown().finally(() => process.exit(0)); };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

const scope = new GGLocatorScope("discovery-local", undefined, "discovery-local");
scope.run(main).catch((err) => {
    GGLog.error("discovery-local", err);
    process.exit(1);
});
