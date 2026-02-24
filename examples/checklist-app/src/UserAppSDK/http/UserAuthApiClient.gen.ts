/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {FORBIDDEN, GGResultPromise, NOT_AUTHORIZED, NOT_FOUND, OK, SERVER_ERROR, VALIDATION_ERROR} from '@grest-ts/schema'
import {GGHttpClientConfig, GGHttpClientGen} from '@grest-ts/http/browser'
import {IsObject, IsString} from '@grest-ts/validator'
import type {UserAuthState} from '../auth/UserAuthState.gen'
import type {User, tUserId} from '../shared/shared-types.gen'

export class UserAuthApiClient extends GGHttpClientGen<UserAuthState> {

    constructor(auth: UserAuthState, config?: GGHttpClientConfig) {
        super("UserAuthApi", auth, config);
    }

    public changePassword(body: ChangePasswordRequest): GGResultPromise<
        void,
        NOT_AUTHORIZED
        | VALIDATION_ERROR<ChangePasswordRequest>
        | SERVER_ERROR
    > {
        return this.__client.request("POST", "/api/users/changePassword", this.contracts.changePassword, body)
    }

    public me(): GGResultPromise<
        User,
        NOT_FOUND
        | NOT_AUTHORIZED
        | FORBIDDEN
        | SERVER_ERROR
        | SERVER_ERROR
    > {
        return this.__client.request("GET", "/api/users/me", this.contracts.me, undefined)
    }

    private readonly contracts = this.__defineApi({
        changePassword: {
            input: IsChangePasswordRequest,
            allowedErrors: [NOT_AUTHORIZED, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: undefined as undefined
            }
        },
        me: {
            allowedErrors: [NOT_FOUND, NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsUser
            }
        }
    })

}

// ---------------------------------------------------------
// Interfaces
// ---------------------------------------------------------

export interface ChangePasswordRequest {
    oldPassword: string
    newPassword: string
}

// ---------------------------------------------------------
// Validators
// ---------------------------------------------------------

const IsChangePasswordRequest: IsObject<ChangePasswordRequest> = new IsObject(() => ({
    oldPassword: IsString,
    newPassword: IsString
}))

const IsUserId = new IsString<tUserId>()

const IsUser: IsObject<User> = new IsObject(() => ({
    id: IsUserId,
    username: IsString,
    email: IsString
}))
