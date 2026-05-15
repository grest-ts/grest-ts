import {IPCServer} from "@grest-ts/ipc";

import {GGServiceDiscoveryEntry} from "./GGLocalDiscoveryClient";

export interface DiscoverApiResult {
    success: boolean;
    url?: string;
    error?: string;
}

/** What kind of process is holding the router port. `bin` is the
 *  standalone `discovery-local` launcher; `embedded` is a runtime that
 *  leader-elected its own server because no bin was up. */
export type ServerKind = "bin" | "embedded";

export interface ServerInfo {
    kind: ServerKind;
}

export const GGDiscoveryIPC = {
    discoveryServer: {
        register: IPCServer.defineRequest<GGServiceDiscoveryEntry[], void>("discovery/register"),
        unregister: IPCServer.defineRequest<GGServiceDiscoveryEntry[], void>("discovery/unregister"),
        discoverApi: IPCServer.defineRequest<string, DiscoverApiResult>("discovery/discoverApi"),
        /** Identify the holder so connecting clients can decide whether
         *  to ever bid for the port (bin = never bid). */
        getServerInfo: IPCServer.defineRequest<undefined, ServerInfo>("discovery/getServerInfo"),
        /** Ask the holder to release the port. The holder ack's
         *  immediately, then teardowns its IPC server. */
        requestYield: IPCServer.defineRequest<undefined, void>("discovery/requestYield"),
    }
}
