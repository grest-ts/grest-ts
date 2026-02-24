/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {GGResultPromise, OK, SERVER_ERROR} from '@grest-ts/schema'
import {GGHttpClientConfig, GGHttpClientGen} from '@grest-ts/http/browser'
import {IsBoolean, IsObject} from '@grest-ts/validator'

export class PurePublicApiClient extends GGHttpClientGen<undefined> {

    constructor(config?: GGHttpClientConfig) {
        super("PurePublicApi", undefined, config);
    }

    public status(): GGResultPromise<{ status: boolean }, SERVER_ERROR> {
        return this.__client.request("GET", "/status/status", this.contracts.status, undefined)
    }

    private readonly contracts = this.__defineApi({
        status: {
            allowedErrors: [SERVER_ERROR],
            output: {
                [OK.TYPE]: new IsObject({
                    status: IsBoolean
                })
            }
        }
    })

}
