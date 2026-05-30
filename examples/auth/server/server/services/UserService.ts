import {EXISTS, GGContractImplementation, NOT_AUTHORIZED} from "@grest-ts/schema"
import {AuthToken} from "@grest-ts/auth"
import {AuthPublicApiContract, InvalidCredentialsError, RegisterRequest, LoginRequest, AuthResponse} from "../../../api/AuthPublicApi"
import {UserApiContract, UpdateProfileRequest} from "../../../api/UserApi"
import {UserContext, UserPermission, tUserId, User} from "../../../api/auth/UserAuth"
import {UserTable} from "../tables/UserTable"

const BANNER_USERS = new Set(["alice", "carol"])

export class UserService implements
    GGContractImplementation<typeof AuthPublicApiContract["methods"]>,
    GGContractImplementation<typeof UserApiContract["methods"]> {

    private readonly table = new UserTable()
    private onProfileUpdated: ((user: User) => void) | undefined

    constructor(private readonly tokenEngine: AuthToken<UserPermission>) {}

    setOnProfileUpdatedCallback(cb: (user: User) => void): void {
        this.onProfileUpdated = cb
    }

    public register = async (request: RegisterRequest): Promise<AuthResponse> => {
        if (this.table.findByUsername(request.username)) throw new EXISTS()
        const permissions: UserPermission[] = BANNER_USERS.has(request.username)
            ? [UserPermission.CAN_SEE_RED_BANNER]
            : []
        const record = this.table.create({username: request.username, email: request.email, password: request.password, permissions})
        const {accessToken, refreshToken} = await this.tokenEngine.issue(record.id, permissions, {})
        return {accessToken, refreshToken, user: {id: record.id, username: record.username, email: record.email}}
    }

    public login = async (request: LoginRequest): Promise<AuthResponse> => {
        const record = this.table.findByUsername(request.username)
        if (!record || record.password !== request.password) throw new InvalidCredentialsError()
        const {accessToken, refreshToken} = await this.tokenEngine.issue(record.id, record.permissions, {})
        return {accessToken, refreshToken, user: {id: record.id, username: record.username, email: record.email}}
    }

    public me = async (): Promise<User> => UserContext.get()!

    public updateProfile = async (request: UpdateProfileRequest): Promise<User> => {
        const current = UserContext.get()!
        const record = this.table.update(current.id, {email: request.email})
        if (!record) throw new NOT_AUTHORIZED()
        const updated: User = {id: record.id, username: record.username, email: record.email}
        this.onProfileUpdated?.(updated)
        return updated
    }

    public getUserById(id: tUserId): User | undefined {
        return this.table.get(id)
    }
}
