import {IPCServer} from "@grest-ts/ipc";
import {GGLocatorKey} from "@grest-ts/locator";
import {GGTestRuntimeWorker} from "@grest-ts/testkit";
import {GGHttpServer} from "../../src/server/GGHttpServer";

export interface GGHttpAddress {
    host: string
    port: number
}

export const GGHttpTestIPC = {
    addresses: IPCServer.defineRequest<GGHttpAddress[], void>("http/addresses"),
}

// Discovery only knows `localhost:<port>` per API; this is what ties a port to the runtime that listens on it.
GGTestRuntimeWorker.onRuntimeStarted(async (worker) => {
    const scope = worker.runtime.scope;
    const servers = scope.getKeys()
        .map(name => scope.tryGet(new GGLocatorKey<unknown>(name)))
        .filter((value): value is GGHttpServer => value instanceof GGHttpServer);
    await worker.ipcClient.sendFrameworkRequest(GGHttpTestIPC.addresses, [...new Set(servers)].map(server => ({host: server.host, port: server.port!})));
});
