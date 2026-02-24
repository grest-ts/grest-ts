import {ServiceBusClient, ServiceBusReceiver} from "@azure/service-bus"
import {GGLog} from "@grest-ts/logger"
import {GGResource, GGSecret} from "@grest-ts/config"
import {EventSubscriberConfig, ReceivedMessage, SubscriberTransport} from "@grest-ts/events"
import {IsObject, IsString} from "@grest-ts/schema"

export interface AzureServiceBusSubscriberResourceData {
    readonly subscriptionName: string
}

export interface AzureServiceBusSubscriberCredentialsData {
    readonly connectionString: string
}

export interface AzureServiceBusSubscriberProviderConfig {
    readonly resource: GGResource<AzureServiceBusSubscriberResourceData>
    readonly credentials: GGSecret<AzureServiceBusSubscriberCredentialsData>
}

const IsAzureServiceBusSubscriberResourceData = IsObject({subscriptionName: IsString})
const IsAzureServiceBusSubscriberCredentialsData = IsObject({connectionString: IsString})

export function createAzureServiceBusSubscriberProviderConfig(queueName: string): AzureServiceBusSubscriberProviderConfig {
    return {
        resource: new GGResource<AzureServiceBusSubscriberResourceData>(`events/azure_servicebus/${queueName}/resource`, IsAzureServiceBusSubscriberResourceData, "Azure Service Bus subscription resource"),
        credentials: new GGSecret<AzureServiceBusSubscriberCredentialsData>(`events/azure_servicebus/${queueName}/credentials`, IsAzureServiceBusSubscriberCredentialsData, "Azure Service Bus credentials")
    }
}

export class AzureServiceBusSubscriberAdapter implements SubscriberTransport {

    public readonly serviceName: string
    protected readonly config: EventSubscriberConfig<any, AzureServiceBusSubscriberProviderConfig>
    private client: ServiceBusClient | null = null
    private receiver: ServiceBusReceiver | null = null

    constructor(serviceName: string, config: EventSubscriberConfig<any, AzureServiceBusSubscriberProviderConfig>) {
        this.serviceName = serviceName
        this.config = config
    }

    public async start(): Promise<void> {
        const azure = this.config.providerConfig.resource.get()
        const credentials = this.config.providerConfig.credentials.reveal()
        if (!credentials.connectionString || !azure.subscriptionName) {
            return
        }

        this.client = new ServiceBusClient(credentials.connectionString)
        this.receiver = this.client.createReceiver(
            this.config.resource.topic.topicName,
            azure.subscriptionName,
            {
                receiveMode: "peekLock"
            }
        )
    }

    public isConfigured(): boolean {
        return this.client !== null
    }

    public async receiveMessages(): Promise<ReceivedMessage[]> {
        const settings = this.config.settings.get()
        const maxMessages = settings.batchSize ?? 10
        const waitTimeMs = (settings.waitTimeSeconds ?? 20) * 1000

        GGLog.debug(this, `Polling Azure Service Bus subscription ${this.config.providerConfig.resource.get().subscriptionName}`)

        const messages = await this.receiver.receiveMessages(maxMessages, {
            maxWaitTimeInMs: waitTimeMs
        })

        return messages.map((msg: any) => ({
            messageId: msg.messageId || "",
            receiptHandle: JSON.stringify({
                lockToken: msg.lockToken,
                sequenceNumber: msg.sequenceNumber
            }),
            body: typeof msg.body === 'string' ? msg.body : JSON.stringify(msg.body),
            receiveCount: msg.deliveryCount || 1,
            sentTimestamp: msg.enqueuedTimeUtc?.getTime() || Date.now(),
            _azureMessage: msg
        }))
    }

    public async deleteMessage(receiptHandle: string): Promise<void> {
        const handle = JSON.parse(receiptHandle)
        const messages = await this.receiver.receiveDeferredMessages(handle.sequenceNumber)
        if (messages.length > 0) {
            await this.receiver.completeMessage(messages[0])
        }

        GGLog.debug(this, `Completed Azure Service Bus message`, {receiptHandle: receiptHandle.substring(0, 20)})
    }

    public destroy(): void {
        if (this.receiver) {
            this.receiver.close()
            this.receiver = null
        }
        if (this.client) {
            this.client.close()
            this.client = null
        }
    }

    public notify(): void {
        // No-op - Azure uses pull-based receiving
    }
}
