/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {BAD_REQUEST, EXISTS, FORBIDDEN, GGResultPromise, OK, SERVER_ERROR, VALIDATION_ERROR} from '@grest-ts/schema'
import {GGHttpClientConfig, GGHttpClientGen} from '@grest-ts/http/browser'
import {IsEmail, IsObject, IsString, IsStringRange} from '@grest-ts/validator'
import type {tEmail, tStringRange} from '@grest-ts/validator'
import type {User, tUserAuthToken, tUserId} from '../shared/shared-types.gen'

export class UserPublicApiClient extends GGHttpClientGen<undefined> {

    constructor(config?: GGHttpClientConfig) {
        super("UserPublicApi", undefined, config);
    }

    public register(body: RegisterRequest): GGResultPromise<
        LoginResponse,
        EXISTS
        | FORBIDDEN
        | BadUsernameError
        | InvalidCredentialsError
        | VALIDATION_ERROR<RegisterRequest>
        | SERVER_ERROR
    > {
        return this.__client.request("POST", "/pub/users/register", this.contracts.register, body)
    }

    public login(body: LoginRequest): GGResultPromise<
        LoginResponse,
        FORBIDDEN
        | InvalidCredentialsError
        | VALIDATION_ERROR<LoginRequest>
        | SERVER_ERROR
    > {
        return this.__client.request("POST", "/pub/users/login", this.contracts.login, body)
    }

    private readonly contracts = this.__defineApi({
        register: {
            input: IsRegisterRequest,
            allowedErrors: [EXISTS, FORBIDDEN, BadUsernameError, InvalidCredentialsError, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsLoginResponse,
                [BadUsernameError.TYPE]: new IsObject({
                    reason: IsString
                })
            },
            errors: {
                "BAD_USERNAME": BadUsernameError,
                "INVALID_CREDENTIALS": InvalidCredentialsError
            }
        },
        login: {
            input: IsLoginRequest,
            allowedErrors: [FORBIDDEN, InvalidCredentialsError, VALIDATION_ERROR, SERVER_ERROR],
            output: {
                [OK.TYPE]: IsLoginResponse
            },
            errors: {
                "INVALID_CREDENTIALS": InvalidCredentialsError
            }
        }
    })

}

// ---------------------------------------------------------
// Errors
// ---------------------------------------------------------

export class BadUsernameError extends BAD_REQUEST<"BAD_USERNAME", { reason: string }> {
    public static TYPE = "BAD_USERNAME"

    constructor(data: { reason: string }) {
        super("BAD_USERNAME", data);
    }
}

export class InvalidCredentialsError extends BAD_REQUEST<"INVALID_CREDENTIALS", undefined> {
    public static TYPE = "INVALID_CREDENTIALS"

    constructor() {
        super("INVALID_CREDENTIALS", undefined);
    }
}

// ---------------------------------------------------------
// Interfaces
// ---------------------------------------------------------

export interface RegisterRequest {
    username: tStringRange<3, 10>
    email: tEmail
    password: string
}

export interface LoginRequest {
    username: string
    password: string
}

export interface LoginResponse {
    token: tUserAuthToken
    user: User
}

// ---------------------------------------------------------
// Validators
// ---------------------------------------------------------

const IsRegisterRequest: IsObject<RegisterRequest> = new IsObject(() => ({
    username: new IsStringRange(3, 10),
    email: IsEmail,
    password: IsString
}))

const IsUserAuthToken = new IsString<tUserAuthToken>()

const IsUserId = new IsString<tUserId>()

const IsUser: IsObject<User> = new IsObject(() => ({
    id: IsUserId,
    username: IsString,
    email: IsString
}))

const IsLoginResponse: IsObject<LoginResponse> = new IsObject(() => ({
    token: IsUserAuthToken,
    user: IsUser
}))

const IsLoginRequest: IsObject<LoginRequest> = new IsObject(() => ({
    username: IsString,
    password: IsString
}))
