import {GGContextKey, GGTransportMiddleware} from "@grest-ts/context";
import {GG_USER_AUTH_TOKEN, IsUser, User} from "../common/api-user/auth/UserAuth";
import {NOT_AUTHORIZED} from "@grest-ts/schema";
import {UserService} from "./services/UserService";

export const UserContext = new GGContextKey<User>("userData", IsUser);

export class UserContextMiddleware implements GGTransportMiddleware {

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
