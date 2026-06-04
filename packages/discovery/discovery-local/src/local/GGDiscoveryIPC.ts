import {IPCServer} from "@grest-ts/ipc";

import {GGServiceDiscoveryEntry} from "./GGLocalDiscoveryClient";
import {enumOf, type Values} from "@grest-ts/common";

export interface DiscoverApiResult {
    success: boolean;
    url?: string;
    error?: string;
}

export const DiscoveryServerKind = enumOf({
    Bin: "bin",
    Embedded: "embedded",
});
export type DiscoveryServerKind = Values<typeof DiscoveryServerKind>;

export const GGDiscoveryIPC = {
    discoveryServer: {
        register: IPCServer.defineRequest<GGServiceDiscoveryEntry[], void>("discovery/register"),
        unregister: IPCServer.defineRequest<GGServiceDiscoveryEntry[], void>("discovery/unregister"),
        discoverApi: IPCServer.defineRequest<string, DiscoverApiResult>("discovery/discoverApi"),
        getServerInfo: IPCServer.defineRequest<undefined, {kind: DiscoveryServerKind}>("discovery/getServerInfo"),
        requestYield: IPCServer.defineRequest<undefined, void>("discovery/requestYield"),
    }
}
