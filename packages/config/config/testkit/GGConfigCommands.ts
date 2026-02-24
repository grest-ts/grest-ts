import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "@grest-ts/testkit";
import {IPCClient} from "@grest-ts/ipc";
import {GGConfigTestStore} from "./GGConfigTestStore";
import {GGConfigKey} from "../src/GGConfigKey";
import {GG_CONFIG} from "../src/GG_CONFIG";

export interface ConfigUpdatePayload {
    storeName: string;
    keyName: string;
    value: unknown;
}

export interface ConfigGetPayload {
    storeName: string;
    keyName: string;
}

export const GGConfigIPC = {
    worker: {
        update: IPCClient.defineRequest<ConfigUpdatePayload, void>("config.update"),
        replace: IPCClient.defineRequest<ConfigUpdatePayload, void>("config.replace"),
        get: IPCClient.defineRequest<ConfigGetPayload, unknown>("config.get"),
        resetAfterTest: IPCClient.defineRequest<void, void>("config.resetAfterTest"),
    }
}

// Register handler - safe at module load time, executed during worker.start()
GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    const getStore = (storeName: string): GGConfigTestStore => {
        const store = GG_CONFIG.get().getStoreByConfigKeyName(storeName);
        if (!(store instanceof GGConfigTestStore)) throw new Error("Store is not wrapped with GGConfigTestStore");
        return store;
    }

    worker.ipcClient.onFrameworkRequest(GGConfigIPC.worker.get, async (payload) => {
        worker.runtime.scope.enter();
        return getStore(payload.storeName).getValue(GGConfigKey.getKey(payload.keyName));
    });

    worker.ipcClient.onFrameworkRequest(GGConfigIPC.worker.update, async (payload) => {
        worker.runtime.scope.enter();
        await getStore(payload.storeName).updateValueOverride(GGConfigKey.getKey(payload.keyName), payload.value);
    });

    worker.ipcClient.onFrameworkRequest(GGConfigIPC.worker.replace, async (payload) => {
        worker.runtime.scope.enter();
        await getStore(payload.storeName).replaceValueOverride(GGConfigKey.getKey(payload.keyName), payload.value);
    });

    worker.ipcClient.onFrameworkRequest(GGConfigIPC.worker.resetAfterTest, async () => {
        worker.runtime.scope.enter();
        for (const store of GG_CONFIG.get().getStores().values()) {
            await (store as GGConfigTestStore).resetAfterTest();
        }
    });
});