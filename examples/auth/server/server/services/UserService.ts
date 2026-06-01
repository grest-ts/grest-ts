import {EXISTS, GGContractImplementation, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {GGAuthToken} from "@grest-ts/auth"
import {AuthPublicApiContract, AuthResponse, InvalidCredentialsError, LoginRequest, RefreshRequest, RegisterRequest, TokenPairResponse} from "../../../api/AuthPublicApi"
import {UpdateProfileRequest, UserApiContract} from "../../../api/UserApi"
import {tUserId, User, UserPermission} from "../../../api/auth/UserAuth"
import {USER_DATA} from "../auth/UserAuthHandler"
import {UserTable} from "../tables/UserTable"

const BANNER_USERS = new Set(["alice", "carol"])

export class UserService implements GGContractImplementation<typeof AuthPublicApiContract["methods"]>,
    GGContractImplementation<typeof UserApiContract["methods"]> {

    private readonly table = new UserTable()
    private onProfileUpdated: ((user: User) => void) | undefined

    constructor(private readonly tokenEngine: GGAuthToken<User>) {
    }

    public setOnProfileUpdatedCallback(cb: (user: User) => void): void {
        this.onProfileUpdated = cb
    }

    public register = async (request: RegisterRequest): Promise<AuthResponse> => {
        if (this.table.findByUsername(request.username)) throw new EXISTS()
        const record = this.table.create({
            ...request,
            permissions: BANNER_USERS.has(request.username) ? [UserPermission.CAN_UPDATE_RED_BANNER_COUNTER] : []
        })
        return {
            ...(await this.tokenEngine.issue(record.id, record)),
            data: record
        }
    }

    public login = async (request: LoginRequest): Promise<AuthResponse> => {
        const record = this.table.findByUsername(request.username)
        if (!record || record.password !== request.password) throw new InvalidCredentialsError()
        return {
            ...(await this.tokenEngine.issue(record.id, record)),
            data: record
        }
    }

    public refresh = async ({refreshToken}: RefreshRequest): Promise<TokenPairResponse> => {
        return await this.tokenEngine.refresh(refreshToken, async (subject) => {
            return this.table.getRecord(subject as tUserId)
        })
    }

    public me = async (): Promise<User> => {
        return USER_DATA.get()!
    }

    public updateProfile = async (request: UpdateProfileRequest): Promise<User> => {
        const record = this.table.update(USER_DATA.get().id, {email: request.email})
        if (!record) throw new NOT_FOUND()
        this.onProfileUpdated?.(record)
        return record
    }

    public getUserById(id: tUserId): User | undefined {
        return this.table.get(id)
    }

    // Called by USER_TOKEN_WIRE's server handler during process() to turn the raw bearer
    // token into a verified payload (subject + permissions).
    public verifyAccessToken = async (token: string | undefined) => {
        if (!token) throw new NOT_AUTHORIZED({debugMessage: "Missing bearer token"})
        return await this.tokenEngine.verifyAccess(token)
    }
}
