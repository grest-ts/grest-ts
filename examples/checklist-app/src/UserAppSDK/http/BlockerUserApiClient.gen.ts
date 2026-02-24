/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {GGResultPromise, NOT_AUTHORIZED, OK, SERVER_ERROR, VALIDATION_ERROR} from '@grest-ts/schema'
import {GGHttpClientConfig, GGHttpClientGen} from '@grest-ts/http/browser'
import {IsObject, IsString, IsUndefined} from '@grest-ts/validator'
import type {UserAuthState} from '../auth/UserAuthState.gen'

export class BlockerUserApiClient extends GGHttpClientGen<UserAuthState> {

    constructor(auth: UserAuthState, config?: GGHttpClientConfig) {
        super("BlockerUserApi", auth, config);
    }

    public blockUser(body: BlockUserRequest): GGResultPromise<
        void,
        NOT_AUTHORIZED
        | VALIDATION_ERROR<BlockUserRequest>
        | SERVER_ERROR
    > {
        return this.__client.request("POST", "/api/blocker/blockUser", this.contracts.blockUser, body)
    }

    private readonly contracts = this.__defineApi({
        blockUser: {
            input: IsBlockUserRequest,
            allowedErrors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: undefined as undefined
            }
        }
    })

}

// ---------------------------------------------------------
// Interfaces
// ---------------------------------------------------------

export interface BlockUserRequest {
    username: string
    reason?: string
}

// ---------------------------------------------------------
// Validators
// ---------------------------------------------------------

const IsBlockUserRequest: IsObject<BlockUserRequest> = new IsObject(() => ({
    username: IsString,
    reason: new IsUndefined(IsString)
}))
