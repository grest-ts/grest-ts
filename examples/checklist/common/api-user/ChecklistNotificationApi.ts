import {GGWebSocketSchema} from "@grest-ts/websocket"
import {IsBoolean, IsObject, IsString, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS, GGDuplexContract } from "@grest-ts/schema";
import {IsChecklistItem} from "./ChecklistApi"
import {GG_USER_AUTH_TOKEN} from "./auth/UserAuth"

export const IsItemMarkedEvent = IsObject({
    item: IsChecklistItem,
    markedBy: IsString
})
export type ItemMarkedEvent = typeof IsItemMarkedEvent.infer

export const IsUpdateItemResponse = IsObject({
    success: IsBoolean,
    message: IsString,
    reason: IsString.orUndefined
})
export type UpdateItemResponse = typeof IsUpdateItemResponse.infer

export const IsUpdateItemRequest = IsObject({
    item: IsChecklistItem,
    reason: IsString.orUndefined
})

export const ChecklistNotificationApiContract = new GGDuplexContract("ChecklistNotificationApi", {
    connect: {
        errors: [NOT_AUTHORIZED, SERVER_ERROR]
    },
    clientToServer: {
        updateItem: {
            input: IsUpdateItemRequest,
            success: IsUpdateItemResponse,
            errors: [VALIDATION_ERROR, SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        },
        askMeAmIHere: {permission: GG_NO_PERMISSIONS}
    },
    serverToClient: {
        itemMarked: {
            input: IsItemMarkedEvent,
            permission: GG_NO_PERMISSIONS
        },
        areYouThere: {
            success: IsBoolean,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        }
    }
})

export const ChecklistNotificationApi = new GGWebSocketSchema({
    contract: ChecklistNotificationApiContract,
    path: "ws/checklist/notifications",
    use: [GG_USER_AUTH_TOKEN],
})

