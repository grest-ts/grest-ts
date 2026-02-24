/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {GGHttpClientConfig, GGHttpClientGen, GGResultPromise, NOT_AUTHORIZED, OK, SERVER_ERROR} from '@grest-ts/http/browser'
import {IsNumber, IsObject} from '@grest-ts/validator'
import type {UserAuthState} from '../auth/UserAuthState.gen'

export class ConfigTestApiClient extends GGHttpClientGen<UserAuthState> {

    constructor(auth: UserAuthState, config?: GGHttpClientConfig) {
        super("ConfigTestApi", auth, config);
    }

    public getWatchedValue(): GGResultPromise<
        ConfigTestResponse,
        NOT_AUTHORIZED
        | SERVER_ERROR
    > {
        return this.__client.request("GET", "/api/config-test/watched-value", this.contracts.getWatchedValue, undefined)
    }

    private readonly contracts = this.__defineApi({
        getWatchedValue: {
            allowedErrors: [NOT_AUTHORIZED, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsConfigTestResponse
            }
        }
    })

}

// ---------------------------------------------------------
// Interfaces
// ---------------------------------------------------------

export interface ConfigTestResponse {
    watchedTimeout: number
}

// ---------------------------------------------------------
// Validators
// ---------------------------------------------------------

const IsConfigTestResponse: IsObject<ConfigTestResponse> = new IsObject(() => ({
    watchedTimeout: IsNumber
}))
