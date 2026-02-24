import {ChecklistService} from "./ChecklistService"
import {ChecklistNotificationApiContract, ItemMarkedEvent, UpdateItemResponse} from "../../common/api-user/ChecklistNotificationApi"
import {ChecklistItem} from "../../common/api-user/ChecklistApi"
import {GGLog} from "@grest-ts/logger"
import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket"
import {tUserId} from "../../common/api-user/auth/UserAuth";
import {UserContext} from "../UserContext";
import {GGContractClient, GGContractImplementation} from "@grest-ts/schema";

// Type for the incoming handler object (implementation returns Promise)
type IncomingHandler = WebSocketIncoming<GGContractImplementation<typeof ChecklistNotificationApiContract.methods["clientToServer"]>>

// Type for the outgoing object (server->client methods)
type OutgoingConnection = WebSocketOutgoing<GGContractClient<typeof ChecklistNotificationApiContract.methods["serverToClient"]>>

/**
 * Service that manages real-time WebSocket notifications for checklist updates.
 * Tracks connected clients per user and broadcasts item marked events.
 */
export class NotificationService {
    // Track all connected WebSocket clients, organized by token (simplified for demo)
    private connectedClients = new Map<tUserId, Set<OutgoingConnection>>()

    constructor(
        private checklistService: ChecklistService
    ) {

        this.checklistService.setOnItemMarkedCallback((event: ItemMarkedEvent) => {
            this.broadcastItemMarked(event)
        })
    }

    public handleConnection = (incoming: IncomingHandler, outgoing: OutgoingConnection): void => {
        const user = UserContext.get()

        // Add this connection to the user's set of connections
        if (!this.connectedClients.has(user.id)) {
            this.connectedClients.set(user.id, new Set())
        }
        this.connectedClients.get(user.id)!.add(outgoing)

        incoming.on({
            updateItem: async (arg: { item: ChecklistItem, reason?: string }): Promise<UpdateItemResponse> => {
                const user = UserContext.get();
                GGLog.debug(this, 'Updating item for user: ' + user.username)
                await this.checklistService.edit({
                    id: arg.item.id,
                    title: arg.item.title,
                    description: arg.item.description
                })
                return {
                    success: true,
                    message: arg.reason
                        ? `Item updated via WebSocket: ${arg.reason}`
                        : "Item updated successfully via WebSocket",
                    reason: arg.reason
                }
            },

            // Handle client asking server to check connection (client->server, triggers server->client->reply)
            askMeAmIHere: async (): Promise<void> => {
                GGLog.debug(this, 'Client asked "am I here?", sending areYouThere check...')
                // Server responds by calling areYouThere on the client
                const response = await outgoing.areYouThere()
                GGLog.debug(this, 'Client responded to areYouThere: ' + response)
            }
        })

        // Remove connection when socket closes
        outgoing.onClose(() => {
            this.handleDisconnection(user.id, outgoing)
        })

        GGLog.info(this, 'WebSocket connected for user token: ' + user.id.substring(0, 8) + '...')
    }

    private handleDisconnection(userId: tUserId, outgoing: OutgoingConnection): void {
        const userConnections = this.connectedClients.get(userId)
        if (userConnections) {
            userConnections.delete(outgoing)
            if (userConnections.size === 0) {
                this.connectedClients.delete(userId)
            }
        }
    }

    private broadcastItemMarked(event: ItemMarkedEvent): void {
        // Broadcast to all connected clients
        // (In a real app, you'd map userId to tokens or track both)
        this.connectedClients.forEach((connections) => {
            connections.forEach(client => {
                client.itemMarked(event)
            })
        })
    }
}
