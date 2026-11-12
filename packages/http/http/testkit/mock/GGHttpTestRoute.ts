import {IPCServer} from "@grest-ts/ipc";
import {GG_TEST_RUNTIME_WORKER} from "@grest-ts/testkit";
import {_registerTestRouteResolver} from "../../src/client/GGHttpSchema.createClient";

export const GGHttpTestRouteIPC = {
    mockedRoute: IPCServer.defineRequest<string, string | undefined>("http/mocked-route"),
}

_registerTestRouteResolver(async (key) => {
    const worker = GG_TEST_RUNTIME_WORKER.tryGet();
    return worker ? worker.ipcClient.sendFrameworkRequest(GGHttpTestRouteIPC.mockedRoute, key) : undefined;
});
