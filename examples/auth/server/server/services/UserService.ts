import {EXISTS, GGContractImplementation, NOT_AUTHORIZED} from "@grest-ts/schema"
import {AuthPublicApiContract, InvalidCredentialsError, RegisterRequest, LoginRequest, AuthResponse} from "../../../api/AuthPublicApi"
import {UserApiContract, UpdateProfileRequest} from "../../../api/UserApi"
import {tUserAuthToken, tUserId, User} from "../../../api/auth/UserAuth"
import {UserContext} from "../UserContext"

interface UserRecord extends User {
    password: string
}

export class UserService implements
    GGContractImplementation<typeof AuthPublicApiContract["methods"]>,
    GGContractImplementation<typeof UserApiContract["methods"]> {

    private readonly users = new Map<tUserId, UserRecord>()
    private readonly tokens = new Map<tUserAuthToken, tUserId>()
    private nextId = 1
    private onProfileUpdated: ((user: User) => void) | undefined

    public setOnProfileUpdatedCallback(cb: (user: User) => void): void {
        this.onProfileUpdated = cb
    }

    public register = async (request: RegisterRequest): Promise<AuthResponse> => {
        const existing = [...this.users.values()].find(u => u.username === request.username)
        if (existing) throw new EXISTS()

        const userId = `user-${this.nextId++}` as tUserId
        this.users.set(userId, {id: userId, username: request.username, email: request.email, password: request.password})

        const token = this.generateToken(userId)
        return {token, user: {id: userId, username: request.username, email: request.email}}
    }

    public login = async (request: LoginRequest): Promise<AuthResponse> => {
        const user = [...this.users.values()].find(u => u.username === request.username)
        if (!user || user.password !== request.password) throw new InvalidCredentialsError()

        const token = this.generateToken(user.id)
        return {token, user: {id: user.id, username: user.username, email: user.email}}
    }

    public me = async (): Promise<User> => {
        return UserContext.get()!
    }

    public updateProfile = async (request: UpdateProfileRequest): Promise<User> => {
        const current = UserContext.get()!
        const record = this.users.get(current.id)
        if (!record) throw new NOT_AUTHORIZED()

        if (request.email !== undefined) record.email = request.email

        const updated: User = {id: record.id, username: record.username, email: record.email}
        this.onProfileUpdated?.(updated)
        return updated
    }

    public getUserByToken(token: tUserAuthToken): User | undefined {
        const userId = this.tokens.get(token)
        if (!userId) return undefined
        const record = this.users.get(userId)
        if (!record) return undefined
        return {id: record.id, username: record.username, email: record.email}
    }

    private generateToken(userId: tUserId): tUserAuthToken {
        const token = `token-${userId}-${Date.now()}` as tUserAuthToken
        this.tokens.set(token, userId)
        return token
    }
}
