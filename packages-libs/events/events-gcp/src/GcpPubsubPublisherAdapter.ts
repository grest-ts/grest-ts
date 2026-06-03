import {PubSub, Topic} from "@google-cloud/pubsub"
import {GGLog} from "@grest-ts/logger"
import {GGResource} from "@grest-ts/config"
import {EventPublisherConfig, PublisherTransport, PublishResult} from "@grest-ts/events"
import {IsObject, IsString} from "@grest-ts/schema"

export interface GcpPubsubResourceData {
    readonly projectId: string
}

export interface GcpPubsubProviderConfig {
    readonly resource: GGResource<GcpPubsubResourceData>
}

const IsGcpPubsubResourceData = IsObject({projectId: IsString})

export function createGcpPubsubProviderConfig(topicName: string): GcpPubsubProviderConfig {
    return {
        resource: new GGResource<GcpPubsubResourceData>(`events/gcp_pubsub/${topicName}/resource`, IsGcpPubsubResourceData, "GCP Pub/Sub topic resource")
    }
}

export class GcpPubsubPublisherAdapter<TMessage> implements PublisherTransport<TMessage> {

    protected readonly config: EventPublisherConfig<any, GcpPubsubProviderConfig>
    private client: PubSub | null = null
    private topic: Topic | null = null

    constructor(config: EventPublisherConfig<any, GcpPubsubProviderConfig>) {
        this.config = config
    }

    public async start(): Promise<void> {
        const gcp = this.config.providerConfig.resource.get()
        if (!gcp.projectId) {
            return
        }

        this.client = new PubSub({projectId: gcp.projectId})
        this.topic = this.client.topic(this.config.resource.topicName)

        await this.verifyTopic(this.topic)
    }

    public isConfigured(): boolean {
        return this.client !== null
    }

    private async verifyTopic(topic: Topic): Promise<void> {
        try {
            const [exists] = await topic.exists()
            if (!exists) {
                throw new Error(`GCP Pub/Sub topic not found: ${this.config.resource.topicName}`)
            }
        } catch (error: any) {
            if (error.code === 7) { // PERMISSION_DENIED
                throw new Error(`No permission to access GCP Pub/Sub topic: ${this.config.resource.topicName}`)
            }
            throw error
        }
    }

    public async publish(message: TMessage): Promise<PublishResult> {
        if (!this.topic) {
            throw new Error(`GCP Pub/Sub publisher not started for topic ${this.config.resource.topicName}`)
        }

        const messageBody = JSON.stringify(message)

        GGLog.debug(this, `Publishing to GCP Pub/Sub topic ${this.config.resource.topicName}:`, message)

        const messageId = await this.topic.publishMessage({
            data: Buffer.from(messageBody)
        })

        return {messageId, messageSize: messageBody.length}
    }

    public async publishBatch(messages: TMessage[]): Promise<void> {
        GGLog.debug(this, `Publishing batch of ${messages.length} messages to GCP Pub/Sub topic ${this.config.resource.topicName}`)

        await Promise.all(messages.map(msg => this.publish(msg)))
    }

    public destroy(): void {
        if (this.client) {
            this.client.close()
            this.client = null
            this.topic = null
        }
    }
}
