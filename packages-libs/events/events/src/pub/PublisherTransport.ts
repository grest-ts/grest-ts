export interface PublishResult {
    messageId: string
    /** Size of the serialized message in bytes */
    messageSize: number
}

export interface PublisherTransport<TMessage> {
    start(): Promise<void>
    isConfigured(): boolean
    publish(message: TMessage): Promise<PublishResult>
    publishBatch(messages: TMessage[]): Promise<void>
    destroy(): void
}
