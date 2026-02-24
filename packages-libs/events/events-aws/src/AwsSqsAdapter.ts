import {DeleteMessageCommand, GetQueueAttributesCommand, Message, ReceiveMessageCommand, SQSClient} from "@aws-sdk/client-sqs"
import {GGLog} from "@grest-ts/logger"
import {GGResource, GGSecret} from "@grest-ts/config"
import {EventSubscriberConfig, ReceivedMessage, SubscriberTransport} from "@grest-ts/events"
import {IsObject, IsString} from "@grest-ts/schema"

export interface AwsSqsResourceData {
    readonly arn: string
}

export interface AwsSqsCredentialsData {
    readonly accessKeyId: string
    readonly secretAccessKey: string
}

export interface AwsSqsProviderConfig {
    readonly resource: GGResource<AwsSqsResourceData>
    readonly credentials: GGSecret<AwsSqsCredentialsData>
}

const IsAwsSqsResourceData = IsObject({arn: IsString})
const IsAwsSqsCredentialsData = IsObject({accessKeyId: IsString, secretAccessKey: IsString})

export function createAwsSqsProviderConfig(queueName: string): AwsSqsProviderConfig {
    return {
        resource: new GGResource<AwsSqsResourceData>(`events/aws_sqs/${queueName}/resource`, IsAwsSqsResourceData, "AWS SQS queue resource"),
        credentials: new GGSecret<AwsSqsCredentialsData>(`events/aws_sqs/${queueName}/credentials`, IsAwsSqsCredentialsData, "AWS SQS credentials")
    }
}

export class AwsSqsAdapter implements SubscriberTransport {

    public readonly serviceName: string
    protected readonly config: EventSubscriberConfig<any, AwsSqsProviderConfig>
    private sqsClient: SQSClient | null = null
    private queueUrl: string | null = null

    constructor(serviceName: string, config: EventSubscriberConfig<any, AwsSqsProviderConfig>) {
        this.serviceName = serviceName
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
        const accountId = arnParts[4]
        const queueName = arnParts[5]

        const endpoint = process.env.AWS_ENDPOINT

        this.sqsClient = new SQSClient({
            region,
            endpoint,
            credentials: credentials ? {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
            } : undefined,
        })

        this.queueUrl = endpoint
            ? `${endpoint}/${accountId}/${queueName}`
            : `https://sqs.${region}.amazonaws.com/${accountId}/${queueName}`

        await this.verifyQueue()
    }

    public isConfigured(): boolean {
        return this.sqsClient !== null
    }

    private async verifyQueue(): Promise<void> {
        try {
            await this.sqsClient!.send(new GetQueueAttributesCommand({
                QueueUrl: this.queueUrl!,
                AttributeNames: ["QueueArn"],
            }))
        } catch (error: any) {
            if (error.name === "QueueDoesNotExist" || error.name === "AWS.SimpleQueueService.NonExistentQueue") {
                throw new Error(`SQS queue not found: ${this.queueUrl}`)
            }
            if (error.name === "AccessDenied" || error.name === "AccessDeniedException") {
                throw new Error(`No permission to access SQS queue: ${this.queueUrl}`)
            }
            throw error
        }
    }

    public async receiveMessages(): Promise<ReceivedMessage[]> {
        const settings = this.config.settings.get()

        GGLog.debug(this, `Polling SQS queue ${this.config.resource.queueName} (batchSize=${settings.batchSize}, wait=${settings.waitTimeSeconds}s)`)

        const response = await this.sqsClient!.send(new ReceiveMessageCommand({
            QueueUrl: this.queueUrl!,
            MaxNumberOfMessages: settings.batchSize ?? 10,
            WaitTimeSeconds: settings.waitTimeSeconds ?? 20,
            VisibilityTimeout: settings.visibilityTimeout ?? 30,
            AttributeNames: ["All"],
        }))

        if (!response.Messages) {
            return []
        }

        return response.Messages.map((msg: Message) => ({
            messageId: msg.MessageId ?? "",
            receiptHandle: msg.ReceiptHandle ?? "",
            body: msg.Body ?? "",
            receiveCount: parseInt(msg.Attributes?.ApproximateReceiveCount ?? "1", 10),
            sentTimestamp: parseInt(msg.Attributes?.SentTimestamp ?? "0", 10),
        }))
    }

    public async deleteMessage(receiptHandle: string): Promise<void> {
        await this.sqsClient!.send(new DeleteMessageCommand({
            QueueUrl: this.queueUrl!,
            ReceiptHandle: receiptHandle,
        }))

        GGLog.debug(this, `Deleted SQS message`, {receiptHandle: receiptHandle.substring(0, 20)})
    }

    public destroy(): void {
        if (this.sqsClient) {
            this.sqsClient.destroy()
            this.sqsClient = null
        }
    }

    public notify(): void {
        // No-op in production. Overridden in tests to wake up polling.
    }
}
