import {GGContextKey} from "@grest-ts/context";
import {GG_USER_AUTH_TOKEN, IsUser, tUserAuthToken, User} from "../common/api-user/auth/UserAuth";
import {NOT_AUTHORIZED} from "@grest-ts/schema";
import type {UserService} from "./services/UserService";

export const UserContext = new GGContextKey<User>("userData", IsUser);

export const GG_USER_AUTH_TOKEN_HANDLER = GG_USER_AUTH_TOKEN.define((userService: UserService) => ({
    process: async () => {
        const token = GG_USER_AUTH_TOKEN.get();
        const user = token ? await userService.getUserByToken(token as tUserAuthToken) : undefined;
        if (!user) {
            throw new NOT_AUTHORIZED({debugMessage: "User not found for token"});
        }
        UserContext.set(user);
    },
}));
