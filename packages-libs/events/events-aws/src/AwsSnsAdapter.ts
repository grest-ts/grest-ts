import {GetTopicAttributesCommand, PublishBatchCommand, PublishBatchRequestEntry, PublishCommand, SNSClient} from "@aws-sdk/client-sns"
import {GGLog} from "@grest-ts/logger"
import {GGResource, GGSecret} from "@grest-ts/config"
import {PublisherTransport, EventPublisherConfig, PublishResult} from "@grest-ts/events"
import {IsObject, IsString} from "@grest-ts/schema"

export interface AwsSnsResourceData {
    readonly arn: string
}

export interface AwsSnsCredentialsData {
    readonly accessKeyId: string
    readonly secretAccessKey: string
}

export interface AwsSnsProviderConfig {
    readonly resource: GGResource<AwsSnsResourceData>
    readonly credentials: GGSecret<AwsSnsCredentialsData>
}

const IsAwsSnsResourceData = IsObject({arn: IsString})
const IsAwsSnsCredentialsData = IsObject({accessKeyId: IsString, secretAccessKey: IsString})

export function createAwsSnsProviderConfig(topicName: string): AwsSnsProviderConfig {
    return {
        resource: new GGResource<AwsSnsResourceData>(`events/aws_sns/${topicName}/resource`, IsAwsSnsResourceData, "AWS SNS topic resource"),
        credentials: new GGSecret<AwsSnsCredentialsData>(`events/aws_sns/${topicName}/credentials`, IsAwsSnsCredentialsData, "AWS SNS credentials")
    }
}

export class AwsSnsAdapter<TMessage> implements PublisherTransport<TMessage> {

    protected readonly config: EventPublisherConfig<any, AwsSnsProviderConfig>
    private snsClient: SNSClient | null = null

    constructor(config: EventPublisherConfig<any, AwsSnsProviderConfig>) {
        this.config = config
    }

    public async start(): Promise<void> {
        const aws = this.config.providerConfig.resource.get()
        if (!aws.arn) {
            return
        }

        const credentials = this.config.providerConfig.credentials.reveal()
        const arnParts = aws.arn.split(":")
        const region = arnParts[3] || "us-east-1"

        this.snsClient = new SNSClient({
            region,
            credentials: credentials.accessKeyId ? {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
            } : undefined,
        })

        await this.verifyTopic()
    }

    public isConfigured(): boolean {
        return this.snsClient !== null
    }

    private async verifyTopic(): Promise<void> {
        const topicArn = this.config.providerConfig.resource.get().arn
        try {
            await this.snsClient!.send(new GetTopicAttributesCommand({
                TopicArn: topicArn,
            }))
        } catch (error: any) {
            if (error.name === "NotFoundException" || error.name === "NotFound") {
                throw new Error(`SNS topic not found: ${topicArn}`)
            }
            if (error.name === "AuthorizationErrorException" || error.name === "AccessDenied") {
                throw new Error(`No permission to access SNS topic: ${topicArn}`)
            }
            throw error
        }
    }

    public async publish(message: TMessage): Promise<PublishResult> {
        const topicArn = this.config.providerConfig.resource.get().arn
        const messageBody = JSON.stringify(message)

        GGLog.debug(this, `Publishing to SNS topic ${this.config.resource.topicName}:`, message)

        const response = await this.snsClient!.send(new PublishCommand({
            TopicArn: topicArn,
            Message: messageBody,
        }))

        return {messageId: response.MessageId ?? "", messageSize: messageBody.length}
    }

    public async publishBatch(messages: TMessage[]): Promise<void> {
        const topicArn = this.config.providerConfig.resource.get().arn

        GGLog.debug(this, `Publishing batch of ${messages.length} messages to SNS topic ${this.config.resource.topicName}`)

        const entries: PublishBatchRequestEntry[] = messages.map((msg, index) => ({
            Id: String(index),
            Message: JSON.stringify(msg),
        }))

        const response = await this.snsClient!.send(new PublishBatchCommand({
            TopicArn: topicArn,
            PublishBatchRequestEntries: entries,
        }))

        if (response.Failed && response.Failed.length > 0) {
            GGLog.error(this, "Some messages failed to publish", {failed: response.Failed})
            throw new Error(`Failed to publish ${response.Failed.length} messages`)
        }
    }

    public destroy(): void {
        if (this.snsClient) {
            this.snsClient.destroy()
            this.snsClient = null
        }
    }
}
