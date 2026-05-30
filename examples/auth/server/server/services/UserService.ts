import {EXISTS, GGContractImplementation, NOT_AUTHORIZED, NOT_FOUND} from "@grest-ts/schema"
import {AuthError, AuthToken} from "@grest-ts/auth"
import {AuthPublicApiContract, InvalidCredentialsError, RegisterRequest, LoginRequest, RefreshRequest, AuthResponse, TokenPairResponse} from "../../../api/AuthPublicApi"
import {UserApiContract, UpdateProfileRequest} from "../../../api/UserApi"
import {UserContext, UserPermission, tUserId, User} from "../../../api/auth/UserAuth"
import {UserTable} from "../tables/UserTable"

const BANNER_USERS = new Set(["alice", "carol"])

export class UserService implements GGContractImplementation<typeof AuthPublicApiContract["methods"]>,
    GGContractImplementation<typeof UserApiContract["methods"]> {

    private readonly table = new UserTable()
    private onProfileUpdated: ((user: User) => void) | undefined

    constructor(private readonly tokenEngine: AuthToken<UserPermission>) {
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
            ...(await this.tokenEngine.issue(record.id, record.permissions, {})),
            user: record
        }
    }

    public login = async (request: LoginRequest): Promise<AuthResponse> => {
        const record = this.table.findByUsername(request.username)
        if (!record || record.password !== request.password) throw new InvalidCredentialsError()
        return {
            ...(await this.tokenEngine.issue(record.id, record.permissions, {})),
            user: record
        }
    }

    public refresh = async ({refreshToken}: RefreshRequest): Promise<TokenPairResponse> => {
        try {
            return await this.tokenEngine.refresh(refreshToken, async (subject) => {
                const record = this.table.getRecord(subject as tUserId)
                if (!record) throw new NOT_AUTHORIZED()
                return {permissions: record.permissions, claims: {}}
            })
        } catch (err) {
            if (err instanceof AuthError) throw new NOT_AUTHORIZED({debugMessage: err.code})
            throw err
        }
    }

    public me = async (): Promise<User> => {
        return UserContext.get()!
    }

    public updateProfile = async (request: UpdateProfileRequest): Promise<User> => {
        const record = this.table.update(UserContext.get().id, {email: request.email})
        if (!record) throw new NOT_FOUND()
        this.onProfileUpdated?.(record)
        return record
    }

    public getUserById(id: tUserId): User | undefined {
        return this.table.get(id)
    }
}
