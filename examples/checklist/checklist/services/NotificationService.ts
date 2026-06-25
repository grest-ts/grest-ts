import {ChecklistService} from "./ChecklistService"
import {ChecklistNotificationApi, ItemMarkedEvent, UpdateItemResponse} from "../../common/api-user/ChecklistNotificationApi"
import {ChecklistItem} from "../../common/api-user/ChecklistApi"
import {GGLog} from "@grest-ts/logger"
import {tUserId} from "../../common/api-user/auth/UserAuth";
import {UserContext} from "../UserContext";

/**
 * Service that manages real-time WebSocket notifications for checklist updates.
 * Tracks connected clients per user and broadcasts item marked events.
 */
export class NotificationService {
    // Track all connected WebSocket clients, organized by token (simplified for demo)
    private connectedClients = new Map<tUserId, Set<typeof ChecklistNotificationApi.serverToClient>>()

    private checklistService: ChecklistService

    constructor(
        checklistService: ChecklistService
    ) {
        this.checklistService = checklistService

        this.checklistService.setOnItemMarkedCallback((event: ItemMarkedEvent) => {
            this.broadcastItemMarked(event)
        })
    }

    public handleConnection = (incoming: typeof ChecklistNotificationApi.clientToServer, outgoing: typeof ChecklistNotificationApi.serverToClient): void => {
        const user = UserContext.assert()

        // Add this connection to the user's set of connections
        if (!this.connectedClients.has(user.id)) {
            this.connectedClients.set(user.id, new Set())
        }
        this.connectedClients.get(user.id)!.add(outgoing)

        incoming.on({
            updateItem: async (arg: { item: ChecklistItem, reason?: string }): Promise<UpdateItemResponse> => {
                const user = UserContext.assert();
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

    private handleDisconnection(userId: tUserId, outgoing: typeof ChecklistNotificationApi.serverToClient): void {
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
