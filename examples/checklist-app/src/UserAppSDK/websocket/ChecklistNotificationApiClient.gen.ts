/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {GGPromise, GGResultPromise, OK, SERVER_ERROR, VALIDATION_ERROR} from '@grest-ts/schema'
import {GGSocket, GGSocketClient, GGSocketPool} from '@grest-ts/http/browser'
import {IsBoolean, IsLatitude, IsLongitude, IsNumber, IsObject, IsString, IsUndefined} from '@grest-ts/validator'
import type {UserAuthState} from '../auth/UserAuthState.gen'
import type {ChecklistItem, User, tChecklistId, tUserId} from '../shared/shared-types.gen'

export interface ChecklistNotificationApiClientMethods {
    itemMarked: (event: ItemMarkedEvent) => void
    areYouThere: () => GGPromise<boolean>
}

export class ChecklistNotificationApiClient extends GGSocketClient<User> {

    constructor(socket: GGSocket<User>, callbacks: ChecklistNotificationApiClientMethods) {
        super(socket)
        this.socket.registerHandler({
            path: "ChecklistNotificationApi.itemMarked",
            handler: (data) => callbacks.itemMarked(data),
            contract: {
                input: IsItemMarkedEvent
            }
        })
        this.socket.registerHandler({
            path: "ChecklistNotificationApi.areYouThere",
            handler: () => callbacks.areYouThere(),
            contract: {
                allowedErrors: [SERVER_ERROR],
                output: {
                    [OK.TYPE]: IsBoolean
                }
            }
        })
    }

    static async connect(auth: UserAuthState, domain: string): Promise<GGSocket<User>> {
        return await GGSocketPool.getOrConnect(auth, {domain, path: "/ws/checklist/notifications"})
    }

    public updateItem(item: ChecklistItem): GGResultPromise<
        UpdateItemResponse,
        VALIDATION_ERROR<ChecklistItem>
        | SERVER_ERROR
    > {
        return this.socket.sendRequest("ChecklistNotificationApi.updateItem", this.contracts.updateItem, item)
    }

    public askMeAmIHere(): void {
        this.socket.send("ChecklistNotificationApi.askMeAmIHere", this.contracts.askMeAmIHere, undefined)
    }

    private readonly contracts = this.__defineApi({
        updateItem: {
            input: IsChecklistItem,
            allowedErrors: [VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsUpdateItemResponse
            }
        },
        askMeAmIHere: {}
    })

}

// ---------------------------------------------------------
// Interfaces
// ---------------------------------------------------------

export interface ItemMarkedEvent {
    item: ChecklistItem
    markedBy: string  // username of the person who marked it
}

export interface UpdateItemResponse {
    success: boolean
    message: string
}

// ---------------------------------------------------------
// Validators
// ---------------------------------------------------------

const IsChecklistId = new IsString<tChecklistId>()

const IsUserId = new IsString<tUserId>()

const IsChecklistItem: IsObject<ChecklistItem> = new IsObject(() => ({
    id: IsChecklistId,
    userId: IsUserId,
    title: IsString,
    description: new IsUndefined(IsString),
    address: new IsUndefined(IsString),
    lat: new IsUndefined(IsLatitude),
    lng: new IsUndefined(IsLongitude),
    done: IsBoolean,
    createdAt: IsNumber,
    updatedAt: IsNumber
}))

const IsItemMarkedEvent: IsObject<ItemMarkedEvent> = new IsObject(() => ({
    item: IsChecklistItem,
    markedBy: IsString
}))

const IsUpdateItemResponse: IsObject<UpdateItemResponse> = new IsObject(() => ({
    success: IsBoolean,
    message: IsString
}))
