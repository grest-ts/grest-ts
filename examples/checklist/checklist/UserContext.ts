import {GGContextKey} from "@grest-ts/context";
import {GG_USER_AUTH_TOKEN, IsUser, User} from "../common/api-user/auth/UserAuth";
import {NOT_AUTHORIZED} from "@grest-ts/schema";
import {UserService} from "./services/UserService";
import {GGHttpServerMiddleware} from "@grest-ts/http";
import {GGWebSocketMiddleware} from "@grest-ts/websocket";

export const UserContext = new GGContextKey<User>("userData", IsUser);

/**
 * Middleware that loads the full User object from the auth token.
 * Implements both GGHttpServerMiddleware and GGWebSocketMiddleware interfaces.
 * Only needs process() since the auth token is already parsed by UserAuth.
 */
export class UserContextMiddleware implements GGHttpServerMiddleware, GGWebSocketMiddleware {

    public constructor(
        private readonly userService: UserService
    ) {
    }

    public async process(): Promise<void> {
        const user = await this.userService.getUserByToken(GG_USER_AUTH_TOKEN.get());
        if (!user) {
            throw new NOT_AUTHORIZED({debugMessage: "User not found for token"});
        }
        UserContext.set(user)
    }

}
