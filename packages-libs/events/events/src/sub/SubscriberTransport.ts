export interface ReceivedMessage {
    messageId: string
    receiptHandle: string
    body: string
    receiveCount: number
    sentTimestamp: number
}

export interface SubscriberTransport {
    start(): Promise<void>
    isConfigured(): boolean
    receiveMessages(): Promise<ReceivedMessage[]>
    deleteMessage(receiptHandle: string): Promise<void>
    notify(): void
    destroy(): void
}
