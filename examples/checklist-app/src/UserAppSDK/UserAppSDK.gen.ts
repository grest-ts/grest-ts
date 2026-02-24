/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import {EXISTS, FORBIDDEN, GGResultPromise, SERVER_ERROR, VALIDATION_ERROR} from '@grest-ts/schema'
import {UserAuthState} from './auth/UserAuthState.gen'
import {BlockerUserApiClient} from './http/BlockerUserApiClient.gen'
import {PurePublicApiClient} from './http/PurePublicApiClient.gen'
import {UserAuthApiClient} from './http/UserAuthApiClient.gen'
import {BadUsernameError, InvalidCredentialsError, LoginRequest, LoginResponse, RegisterRequest, UserPublicApiClient} from './http/UserPublicApiClient.gen'
import {ChecklistNotificationApiClient, ChecklistNotificationApiClientMethods} from './websocket/ChecklistNotificationApiClient.gen'

const DEFAULT_URL = 'http://localhost:3000'

export class UserAppSDK {

    private readonly url: string;
    public readonly purePublic: PurePublicApiClient
    public readonly userPublic: UserPublicApiClient

    constructor(config?: { url?: string }) {
        this.url = config?.url || DEFAULT_URL
        this.purePublic = new PurePublicApiClient({url: this.url})
        this.userPublic = new UserPublicApiClient({url: this.url})
    }

    register(body: RegisterRequest): GGResultPromise<
        LoginResponse & { sdk: UserAppSDKAuthenticated },
        EXISTS
        | FORBIDDEN
        | BadUsernameError
        | InvalidCredentialsError
        | VALIDATION_ERROR<RegisterRequest>
        | SERVER_ERROR
    > {
        return this.userPublic.register(body).map(async (data) => {
            const auth = new UserAuthState();
            auth.setLoggedIn(data)
            return {...data, sdk: new UserAppSDKAuthenticated(auth, {url: this.url})} as const
        })
    }

    login(body: LoginRequest): GGResultPromise<
        LoginResponse & { sdk: UserAppSDKAuthenticated },
        FORBIDDEN
        | InvalidCredentialsError
        | VALIDATION_ERROR<LoginRequest>
        | SERVER_ERROR
    > {
        return this.userPublic.login(body).map(async (data) => {
            const auth = new UserAuthState();
            auth.setLoggedIn(data)
            return {...data, sdk: new UserAppSDKAuthenticated(auth, {url: this.url})} as const
        })
    }

}

export class UserAppSDKAuthenticated {

    public readonly auth: UserAuthState
    private readonly url: string

    public readonly blockerUser: BlockerUserApiClient
    public readonly userAuth: UserAuthApiClient

    constructor(auth: UserAuthState, config: { url?: string }) {
        this.auth = auth
        this.url = config?.url || DEFAULT_URL
        this.blockerUser = new BlockerUserApiClient(this.auth, {url: this.url})
        this.userAuth = new UserAuthApiClient(this.auth, {url: this.url})
    }

    async connectChecklistNotification(handlers: ChecklistNotificationApiClientMethods): Promise<ChecklistNotificationApiClient> {
        const socket = await ChecklistNotificationApiClient.connect(this.auth, this.url)
        return new ChecklistNotificationApiClient(socket, handlers)
    }

}
