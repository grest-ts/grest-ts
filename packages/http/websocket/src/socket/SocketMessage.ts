import {tPendingMessageId} from "./utils/PendingRequestsMap";
import {OK_JSON} from "@grest-ts/schema";

export const DELIMITER = ":"

// Message types (single character for fast type checking)
export enum MessageType {
    HANDSHAKE = "h",   // Handshake request (client -> server with headers)
    HANDSHAKE_OK = "k", // Handshake success (server -> client)
    HANDSHAKE_ERR = "x", // Handshake error (server -> client)
    MSG = "m",         // Regular message (send-and-forget)
    REQ = "r",         // Request (expects response)
    RES = "s",         // Successful response
    PING = "p",        // Application-level liveness ping (peer auto-answers PONG)
    PONG = "o",        // Application-level liveness pong
}

export interface SocketMessage {
    type: MessageType;
    path: string;
    data?: any;
}

export interface HandshakeMessage extends SocketMessage {
    type: MessageType.HANDSHAKE;
    data: Record<string, string>; // Headers
}

export interface HandshakeOkMessage extends SocketMessage {
    type: MessageType.HANDSHAKE_OK;
}

export interface HandshakeErrMessage extends SocketMessage {
    type: MessageType.HANDSHAKE_ERR;
    data: any; // Error details
}

export interface RegularMessage extends SocketMessage {
    type: MessageType.MSG;
    data?: any;
}

export interface RequestMessage extends SocketMessage {
    type: MessageType.REQ;
    id: tPendingMessageId;
    data?: any;
}

export interface ResponseMessage extends SocketMessage {
    type: MessageType.RES;
    id: tPendingMessageId;
    data: OK_JSON<any>
}

export interface PingMessage extends SocketMessage {
    type: MessageType.PING;
}

export interface PongMessage extends SocketMessage {
    type: MessageType.PONG;
}

export type AnyMessage = HandshakeMessage | HandshakeOkMessage | HandshakeErrMessage | RegularMessage | RequestMessage | ResponseMessage | PingMessage | PongMessage;

export class Message {

    public static create(type: MessageType, path: string, id: tPendingMessageId | "", data: any): string {
        const dataStr = data !== undefined ? JSON.stringify(data) : "";
        return type + DELIMITER + String(path) + DELIMITER + (id || "") + DELIMITER + dataStr;
    }

    /** Build a pathless control frame (handshake, ping/pong). */
    public static createControl(type: MessageType, data?: any): string {
        return Message.create(type, "", "", data);
    }

    public static parse(msg: unknown): AnyMessage | undefined {
        if (!msg) {
            return undefined;
        }
        const parts = String(msg).split(DELIMITER);

        // Extract the first 4 parts (type, path, id) and everything else is data
        const type = parts[0];
        const path = parts[1];
        const id = parts[2];
        const data = parts.length > 3 ? parts.slice(3).join(DELIMITER) : undefined;

        // Handshake and liveness ping/pong are pathless control frames.
        const isControl = type === MessageType.HANDSHAKE ||
            type === MessageType.HANDSHAKE_OK ||
            type === MessageType.HANDSHAKE_ERR ||
            type === MessageType.PING ||
            type === MessageType.PONG;

        if (!type || (!isControl && !path)) {
            return undefined;
        }
        let dataParsed: any = undefined;
        if (data) {
            try {
                dataParsed = JSON.parse(data);
            } catch (e) {
                // If JSON parse fails, keep as undefined
            }
        }
        return {
            type: type as MessageType,
            path,
            id: (id || undefined) as any,
            data: dataParsed
        } as AnyMessage;
    }
}
