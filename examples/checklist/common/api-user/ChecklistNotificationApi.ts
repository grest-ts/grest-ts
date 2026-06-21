import {webSocketSchema} from "@grest-ts/websocket"
import {IsBoolean, IsObject, IsString, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
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

export const ChecklistNotificationApiMethods = {
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
}

export const ChecklistNotificationApi = webSocketSchema("ChecklistNotificationApi")
    .path("ws/checklist/notifications")
    .use(GG_USER_AUTH_TOKEN)
    .messages(ChecklistNotificationApiMethods)

