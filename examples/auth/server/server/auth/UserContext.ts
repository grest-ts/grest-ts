import {GGTransportMiddleware} from "@grest-ts/context"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {AuthGuard} from "@grest-ts/auth"
import {UserContext, UserPermission, tUserId} from "../../../api/auth/UserAuth"
import {UserService} from "../services/UserService"

export class UserContextMiddleware implements GGTransportMiddleware {
    constructor(
        private readonly userService: UserService,
        private readonly userGuard: AuthGuard<UserPermission>,
    ) {}

    async process(): Promise<void> {
        const payload = this.userGuard.payload()
        if (!payload) throw new NOT_AUTHORIZED({debugMessage: "No user token payload"})
        const user = await this.userService.getUserById(payload.sub as tUserId)
        if (!user) throw new NOT_AUTHORIZED({debugMessage: "User not found"})
        UserContext.set(user)
    }
}
