import {GGTestContext} from "@grest-ts/testkit";
import {GG_USER_AUTH_TOKEN, tUserAuthToken, User} from "../../../common/api-user/auth/UserAuth";
import {Raw} from "@grest-ts/schema";
import {LoginRequest, RegisterRequest, UserPublicApi} from "../../../common/api-user-public/UserPublicApi";

export class ChecklistUserContext extends GGTestContext {

    public user!: User

    public async register(registerData: Raw<RegisterRequest>) {
        const result = await this.callOn(UserPublicApi).register(registerData);
        this.setLoggedIn(result.token);
        this.user = result.user
    }

    public async login(loginData: Raw<LoginRequest>) {
        const result = await this.callOn(UserPublicApi).login(loginData);
        this.setLoggedIn(result.token);
        this.user = result.user
    }

    public setLoggedIn(token: tUserAuthToken) {
        this.set(GG_USER_AUTH_TOKEN, token);
    }
}