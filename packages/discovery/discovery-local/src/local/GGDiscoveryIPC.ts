import {IPCServer} from "@grest-ts/ipc";

import {GGServiceDiscoveryEntry} from "./GGLocalDiscoveryClient";

export interface DiscoverApiResult {
    success: boolean;
    url?: string;
    error?: string;
}

export enum DiscoveryServerKind {
    Bin = "bin",
    Embedded = "embedded",
}

export const GGDiscoveryIPC = {
    discoveryServer: {
        register: IPCServer.defineRequest<GGServiceDiscoveryEntry[], void>("discovery/register"),
        unregister: IPCServer.defineRequest<GGServiceDiscoveryEntry[], void>("discovery/unregister"),
        discoverApi: IPCServer.defineRequest<string, DiscoverApiResult>("discovery/discoverApi"),
        getServerInfo: IPCServer.defineRequest<undefined, {kind: DiscoveryServerKind}>("discovery/getServerInfo"),
        requestYield: IPCServer.defineRequest<undefined, void>("discovery/requestYield"),
    }
}
