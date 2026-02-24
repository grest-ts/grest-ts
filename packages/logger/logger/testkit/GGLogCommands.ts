import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "@grest-ts/testkit";
import {IPCClient} from "@grest-ts/ipc";
import {CapturedLogEntry, GGTestLogger, SerializableLogMatcher} from "./GGTestLogger";
import {GGLog, LogLevel} from "@grest-ts/logger";

export interface FindFromPayload {
    fromIndex: number;
    matcher: SerializableLogMatcher;
    minLevel?: LogLevel;
}

export interface RetrieveFromPayload {
    fromIndex: number;
    minLevel?: LogLevel;
}

export const GGLogIPC = {
    worker: {
        getCursor: IPCClient.defineRequest<void, number>("logs.getCursor"),
        findFrom: IPCClient.defineRequest<FindFromPayload, CapturedLogEntry | null>("logs.findFrom"),
        retrieveFrom: IPCClient.defineRequest<RetrieveFromPayload, CapturedLogEntry[]>("logs.retrieveFrom"),
    }
}

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get();

    const getLogger = (): GGTestLogger => {
        const logger = GGLog.getLogger(GGTestLogger);
        if (!logger) {
            throw new Error("GGTestLogger not found. Make sure @grest-ts/logger/testkit is loaded.");
        }
        return logger;
    };

    worker.onIpcRequest(GGLogIPC.worker.getCursor, () => {
        return getLogger().getCursor();
    });

    worker.onIpcRequest(GGLogIPC.worker.findFrom, (payload) => {
        return getLogger().findFrom(payload.fromIndex, payload.matcher, payload.minLevel);
    });

    worker.onIpcRequest(GGLogIPC.worker.retrieveFrom, (payload) => {
        return getLogger().retrieveFrom(payload.fromIndex, payload.minLevel);
    });
});
