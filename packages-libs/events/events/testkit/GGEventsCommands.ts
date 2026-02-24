import {EventSubscriberClient} from "../src/sub/EventSubscriberClient"
import {IPCClient, IPCServer} from "@grest-ts/ipc"
import {GG_TEST_RUNTIME_WORKER, GGTestRuntimeWorker} from "@grest-ts/testkit"

export interface SnsPublishPayload {
    topicName: string;
    message: any;
}

export interface SnsPublishResult {
    messageId: string;
    success?: boolean;  // false when mock returns error
}

export interface SqsRegisterPayload {
    serviceName: string;
    topicName: string;
    queueName: string;
    runtimeId: string;
}

export interface SqsPollPayload {
    queueName: string;
    maxMessages: number;
}

export interface SqsPollResult {
    messages: Array<{
        messageId: string;
        body: any;
        receiptHandle: string;
        sentTimestamp: number;
    }>;
}

export interface SqsDeletePayload {
    queueName: string;
    receiptHandle: string;
}

export interface SqsNotifyPayload {
    serviceName: string;
}

export const GGEventsIPC = {
    test: {
        snsPublish: IPCServer.defineRequest<SnsPublishPayload, SnsPublishResult>("events/sns-publish"),
        sqsRegister: IPCServer.defineRequest<SqsRegisterPayload, void>("events/sqs-register"),
        sqsPoll: IPCServer.defineRequest<SqsPollPayload, SqsPollResult>("events/sqs-poll"),
        sqsDelete: IPCServer.defineRequest<SqsDeletePayload, void>("events/sqs-delete"),
    },
    worker: {
        sqsNotify: IPCClient.defineRequest<SqsNotifyPayload, void>("events/sqs-notify")
    }
}

GGTestRuntimeWorker.onBeforeRuntimeStart(() => {
    const worker = GG_TEST_RUNTIME_WORKER.get()
    worker.ipcClient.onFrameworkRequest(GGEventsIPC.worker.sqsNotify, async (payload) => {
        worker.runtime.scope.enter()
        await worker.runtime.scope.getByTokenName(payload.serviceName, EventSubscriberClient).processAvailableMessages()
    })
})

