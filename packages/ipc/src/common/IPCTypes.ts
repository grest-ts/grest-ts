/**
 * Type for messages that the IPC server handles (sent by client, handled by server)
 */
export type IPCServerRequest<Request, Response> = string & {
    __IPCServerRequest: never;
    __request: Request;
    __response: Response;
}

/**
 * Type for messages that the IPC client handles (sent by server, handled by client)
 */
export type IPCClientRequest<Request, Response> = string & {
    __IPCClientRequest: never;
    __request: Request;
    __response: Response;
}
