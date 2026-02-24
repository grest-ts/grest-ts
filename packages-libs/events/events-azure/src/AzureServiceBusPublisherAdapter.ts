import {ServiceBusClient, ServiceBusSender} from "@azure/service-bus"
import {GGLog} from "@grest-ts/logger"
import {GGSecret} from "@grest-ts/config"
import {EventPublisherConfig, PublisherTransport, PublishResult} from "@grest-ts/events"
import {IsObject, IsString} from "@grest-ts/schema"

export interface AzureServiceBusResourceData {
    readonly connectionString: string
}

export interface AzureServiceBusProviderConfig {
    readonly credentials: GGSecret<AzureServiceBusResourceData>
}

const IsAzureServiceBusResourceData = IsObject({connectionString: IsString})

export function createAzureServiceBusProviderConfig(topicName: string): AzureServiceBusProviderConfig {
    return {
        credentials: new GGSecret<AzureServiceBusResourceData>(`events/azure_servicebus/${topicName}/credentials`, IsAzureServiceBusResourceData, "Azure Service Bus credentials")
    }
}

export class AzureServiceBusPublisherAdapter<TMessage> implements PublisherTransport<TMessage> {

    protected readonly config: EventPublisherConfig<any, AzureServiceBusProviderConfig>
    private client: ServiceBusClient | null = null
    private sender: ServiceBusSender | null = null

    constructor(config: EventPublisherConfig<any, AzureServiceBusProviderConfig>) {
        this.config = config
    }

    public async start(): Promise<void> {
        const azure = this.config.providerConfig.credentials.reveal()
        if (!azure.connectionString) {
            return
        }

        this.client = new ServiceBusClient(azure.connectionString)
        this.sender = this.client.createSender(this.config.resource.topicName)
    }

    public isConfigured(): boolean {
        return this.client !== null
    }

    public async publish(message: TMessage): Promise<PublishResult> {
        const messageBody = JSON.stringify(message)

        GGLog.debug(this, `Publishing to Azure Service Bus topic ${this.config.resource.topicName}:`, message)

        await this.sender.sendMessages({
            body: messageBody
        })

        return {messageId: "", messageSize: messageBody.length}
    }

    public async publishBatch(messages: TMessage[]): Promise<void> {
        GGLog.debug(this, `Publishing batch of ${messages.length} messages to Azure Service Bus topic ${this.config.resource.topicName}`)

        const batch = await this.sender.createMessageBatch()
        for (const msg of messages) {
            const messageBody = JSON.stringify(msg)
            if (!batch.tryAddMessage({body: messageBody})) {
                await this.sender.sendMessages(batch)
                const newBatch = await this.sender.createMessageBatch()
                newBatch.tryAddMessage({body: messageBody})
            }
        }

        if (batch.count > 0) {
            await this.sender.sendMessages(batch)
        }
    }

    public destroy(): void {
        if (this.sender) {
            this.sender.close()
            this.sender = null
        }
        if (this.client) {
            this.client.close()
            this.client = null
        }
    }
}
