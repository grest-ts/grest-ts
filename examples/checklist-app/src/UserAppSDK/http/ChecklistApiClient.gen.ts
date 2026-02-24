/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {FORBIDDEN, GGResultPromise, NOT_AUTHORIZED, NOT_FOUND, OK, SERVER_ERROR, VALIDATION_ERROR} from '@grest-ts/schema'
import {GGHttpClientConfig, GGHttpClientGen} from '@grest-ts/http/browser'
import {IsArray, IsBoolean, IsLatitude, IsLongitude, IsNumber, IsObject, IsString, IsUndefined} from '@grest-ts/validator'
import type {tLatitude, tLongitude} from '@grest-ts/validator'
import type {UserAuthState} from '../auth/UserAuthState.gen'
import type {tChecklistId, tUserId} from '../shared/shared-types.gen'

export class ChecklistApiClient extends GGHttpClientGen<UserAuthState> {

    constructor(auth: UserAuthState, config?: GGHttpClientConfig) {
        super("ChecklistApi", auth, config);
    }

    public list(): GGResultPromise<
        ChecklistItem[],
        NOT_AUTHORIZED
        | SERVER_ERROR
    > {
        return this.__client.request("GET", "/api/checklist/list", this.contracts.list, undefined)
    }

    public add(body: AddChecklistRequest): GGResultPromise<
        ChecklistItem,
        NOT_AUTHORIZED
        | VALIDATION_ERROR<AddChecklistRequest>
        | SERVER_ERROR
    > {
        return this.__client.request("POST", "/api/checklist/add", this.contracts.add, body)
    }

    public get(id: tChecklistId): GGResultPromise<
        ChecklistItem,
        FORBIDDEN
        | NOT_FOUND
        | NOT_AUTHORIZED
        | VALIDATION_ERROR<{ id: tChecklistId }>
        | SERVER_ERROR
    > {
        return this.__client.request("GET", "/api/checklist/get/:id", this.contracts.get, {id})
    }

    public edit(body: EditChecklistRequest): GGResultPromise<
        ChecklistItem,
        FORBIDDEN
        | NOT_FOUND
        | NOT_AUTHORIZED
        | VALIDATION_ERROR<EditChecklistRequest>
        | SERVER_ERROR
    > {
        return this.__client.request("PUT", "/api/checklist/edit", this.contracts.edit, body)
    }

    public delete(id: tChecklistId): GGResultPromise<
        void,
        FORBIDDEN
        | NOT_FOUND
        | NOT_AUTHORIZED
        | VALIDATION_ERROR<{ id: tChecklistId }>
        | SERVER_ERROR
    > {
        return this.__client.request("DELETE", "/api/checklist/delete/:id", this.contracts.delete, {id})
    }

    public markDone(id: tChecklistId): GGResultPromise<
        ChecklistItem,
        FORBIDDEN
        | NOT_FOUND
        | NOT_AUTHORIZED
        | VALIDATION_ERROR<{ id: tChecklistId }>
        | SERVER_ERROR
    > {
        return this.__client.request("POST", "/api/checklist/markDone/:id", this.contracts.markDone, {id})
    }

    private readonly contracts = this.__defineApi({
        list: {
            allowedErrors: [NOT_AUTHORIZED, SERVER_ERROR],
            output: {
                [OK.TYPE]: new IsArray(IsChecklistItem)
            }
        },
        add: {
            input: IsAddChecklistRequest,
            allowedErrors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsChecklistItem
            }
        },
        get: {
            input: new IsObject({id: IsChecklistId}),
            allowedErrors: [FORBIDDEN, NOT_FOUND, NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsChecklistItem
            }
        },
        edit: {
            input: IsEditChecklistRequest,
            allowedErrors: [FORBIDDEN, NOT_FOUND, NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsChecklistItem
            }
        },
        delete: {
            input: new IsObject({id: IsChecklistId}),
            allowedErrors: [FORBIDDEN, NOT_FOUND, NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: undefined as undefined
            }
        },
        markDone: {
            input: new IsObject({id: IsChecklistId}),
            allowedErrors: [FORBIDDEN, NOT_FOUND, NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsChecklistItem
            }
        }
    })

}

// ---------------------------------------------------------
// Interfaces
// ---------------------------------------------------------

export interface ChecklistItem {
    id: tChecklistId
    userId: tUserId
    title: string
    description?: string
    address?: string
    lat?: tLatitude
    lng?: tLongitude
    done: boolean
    createdAt: number
    updatedAt: number
}

export interface AddChecklistRequest {
    title: string
    description?: string
    address?: string
}

export interface EditChecklistRequest {
    id: tChecklistId;
    title?: string
    description?: string
    address?: string
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

const IsAddChecklistRequest: IsObject<AddChecklistRequest> = new IsObject(() => ({
    title: IsString,
    description: new IsUndefined(IsString),
    address: new IsUndefined(IsString)
}))

const IsEditChecklistRequest: IsObject<EditChecklistRequest> = new IsObject(() => ({
    id: IsChecklistId,
    title: new IsUndefined(IsString),
    description: new IsUndefined(IsString),
    address: new IsUndefined(IsString)
}))
