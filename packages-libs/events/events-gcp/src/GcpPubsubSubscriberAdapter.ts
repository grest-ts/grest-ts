import {PubSub, Subscription} from "@google-cloud/pubsub"
import {GGLog} from "@grest-ts/logger"
import {GGResource} from "@grest-ts/config"
import {EventSubscriberConfig, ReceivedMessage, SubscriberTransport} from "@grest-ts/events"
import {IsObject, IsString} from "@grest-ts/schema"

export interface GcpPubsubSubscriberResourceData {
    readonly projectId: string
    readonly subscriptionName: string
}

export interface GcpPubsubSubscriberProviderConfig {
    readonly resource: GGResource<GcpPubsubSubscriberResourceData>
}

const IsGcpPubsubSubscriberResourceData = IsObject({
    projectId: IsString,
    subscriptionName: IsString
})

export function createGcpPubsubSubscriberProviderConfig(queueName: string): GcpPubsubSubscriberProviderConfig {
    return {
        resource: new GGResource<GcpPubsubSubscriberResourceData>(`events/gcp_pubsub/${queueName}/resource`, IsGcpPubsubSubscriberResourceData, "GCP Pub/Sub subscription resource")
    }
}

export class GcpPubsubSubscriberAdapter implements SubscriberTransport {

    public readonly serviceName: string
    protected readonly config: EventSubscriberConfig<any, GcpPubsubSubscriberProviderConfig>
    private client: PubSub | null = null
    private subscription: Subscription | null = null
    private pendingMessages: ReceivedMessage[] = []
    private messageResolvers: Map<string, () => void> = new Map()
    private waitingResolver: (() => void) | null = null

    constructor(serviceName: string, config: EventSubscriberConfig<any, GcpPubsubSubscriberProviderConfig>) {
        this.serviceName = serviceName
        this.config = config
    }

    public async start(): Promise<void> {
        const gcp = this.config.providerConfig.resource.get()
        if (!gcp.projectId || !gcp.subscriptionName) {
            return
        }

        this.client = new PubSub({projectId: gcp.projectId})
        this.subscription = this.client.subscription(gcp.subscriptionName)

        await this.verifySubscription()

        this.subscription.on('message', (message: any) => {
            const receivedMessage: ReceivedMessage = {
                messageId: message.id,
                receiptHandle: message.ackId,
                body: message.data.toString(),
                receiveCount: message.deliveryAttempt || 1,
                sentTimestamp: message.publishTime?.getTime() || Date.now(),
            }
            this.pendingMessages.push(receivedMessage)
            this.messageResolvers.set(message.ackId, () => message.ack())

            if (this.waitingResolver) {
                const resolver = this.waitingResolver
                this.waitingResolver = null
                resolver()
            }
        })
    }

    public isConfigured(): boolean {
        return this.client !== null
    }

    private async verifySubscription(): Promise<void> {
        try {
            const [exists] = await this.subscription.exists()
            if (!exists) {
                throw new Error(`GCP Pub/Sub subscription not found: ${this.config.providerConfig.resource.get().subscriptionName}`)
            }
        } catch (error: any) {
            if (error.code === 7) { // PERMISSION_DENIED
                throw new Error(`No permission to access GCP Pub/Sub subscription: ${this.config.providerConfig.resource.get().subscriptionName}`)
            }
            throw error
        }
    }

    public async receiveMessages(): Promise<ReceivedMessage[]> {
        const settings = this.config.settings.get()
        const maxMessages = settings.batchSize ?? 10
        const waitTimeMs = (settings.waitTimeSeconds ?? 20) * 1000

        GGLog.debug(this, `Polling GCP Pub/Sub subscription ${this.config.providerConfig.resource.get().subscriptionName}`)

        if (this.pendingMessages.length === 0) {
            await Promise.race([
                new Promise<void>(resolve => {
                    this.waitingResolver = resolve
                }),
                new Promise<void>(resolve => setTimeout(resolve, waitTimeMs))
            ])
        }

        const messages = this.pendingMessages.splice(0, maxMessages)
        return messages
    }

    public async deleteMessage(receiptHandle: string): Promise<void> {
        const acker = this.messageResolvers.get(receiptHandle)
        if (acker) {
            acker()
            this.messageResolvers.delete(receiptHandle)
        }

        GGLog.debug(this, `Acknowledged GCP Pub/Sub message`, {receiptHandle: receiptHandle.substring(0, 20)})
    }

    public destroy(): void {
        if (this.subscription) {
            this.subscription.removeAllListeners()
        }
        if (this.client) {
            this.client.close()
            this.client = null
            this.subscription = null
        }
        this.pendingMessages = []
        this.messageResolvers.clear()
    }

    public notify(): void {
        if (this.waitingResolver) {
            const resolver = this.waitingResolver
            this.waitingResolver = null
            resolver()
        }
    }
}
