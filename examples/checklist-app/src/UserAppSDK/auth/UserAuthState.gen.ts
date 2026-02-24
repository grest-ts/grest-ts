/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {GGAuthState} from '@grest-ts/auth'
import type {GGAuthStateUpdateRequestOptions} from '@grest-ts/auth'
import type {LoginResponse} from '../http/UserPublicApiClient.gen'

// Copied from server auth state for SDK usage

/**
 * Auth state for the checklist client application.
 * Manages user authentication token and session data.
 */
export class UserAuthState extends GGAuthState<LoginResponse, LoginResponse["token"], LoginResponse["user"]> {

    public static readonly ENTITY_NAME = "User";

    public updateRequest(request: GGAuthStateUpdateRequestOptions): void {
        if (this.isLoggedIn()) {
            request['authorization'] = `Bearer ${this.getToken()}`;
        }
    }

    public setLoggedIn(request: LoginResponse) {
        this._setLoggedIn(request.token, request.user)
    }

}
