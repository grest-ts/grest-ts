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
 */
import {GGLog} from "@grest-ts/logger";
import {GGLocatorScope} from "@grest-ts/locator";
import {IPCServer} from "@grest-ts/ipc";
import {GGLocalDiscoveryServer} from "../local/GGLocalDiscoveryServer";

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

async function main(): Promise<void> {
    const port = parsePort(process.argv.slice(2));
    const server = new IPCServer(port);
    const router = new GGLocalDiscoveryServer(server);
    if (!(await router.start())) {
        GGLog.error("discovery-local", `Port ${port} is already in use — another discovery router is running`);
        process.exit(1);
    }
    GGLog.info("discovery-local", `Discovery router listening on port ${port}`);

    const shutdown = () => {
        router.teardown().finally(() => process.exit(0));
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
