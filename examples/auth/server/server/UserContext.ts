import {GGContextKey} from "@grest-ts/context"
import {GGHttpServerMiddleware} from "@grest-ts/http"
import {GGWebSocketMiddleware} from "@grest-ts/websocket"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {GG_USER_AUTH_TOKEN, IsUser, User} from "../common/api/auth/UserAuth"
import {UserService} from "./services/UserService"

export const UserContext = new GGContextKey<User>("userData", IsUser)

export class UserContextMiddleware implements GGHttpServerMiddleware, GGWebSocketMiddleware {
    constructor(private readonly userService: UserService) {}

    async process(): Promise<void> {
        const user = await this.userService.getUserByToken(GG_USER_AUTH_TOKEN.get())
        if (!user) throw new NOT_AUTHORIZED({debugMessage: "User not found for token"})
        UserContext.set(user)
    }
}
