import {GGContextKey} from "@grest-ts/context"
import {NOT_AUTHORIZED} from "@grest-ts/schema"
import {deepFreeze} from "@grest-ts/common"
import type {UserService} from "../services/UserService"
import {IsUser, USER_TOKEN_WIRE} from "../../../api/auth/UserAuth"

// Durable principal — SERVER-ONLY (handlers/services read it; the client never sees it).
// USER_DATA is the User, which carries permissions (a user-level capability). Deep-frozen so a
// handler can't mutate it to escalate.
export const USER_DATA = new GGContextKey("userData", IsUser)

export const USER_TOKEN_WIRE_HANDLER = USER_TOKEN_WIRE.define((users: UserService) => ({
    process: async () => {
        // USER_TOKEN_WIRE.get() returns the raw bearer token — readable only here.
        const payload = await users.verifyAccessToken(USER_TOKEN_WIRE.get())
        const user = users.getUserById(payload.data.id)
        if (!user) throw new NOT_AUTHORIZED({debugMessage: "User not found"})
        USER_DATA.set(deepFreeze(user))
    },
    permissions: async () => USER_DATA.get()!.permissions,
}))
