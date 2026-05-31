import {GGContextKey} from "@grest-ts/context"
import {IsArray, NOT_AUTHORIZED} from "@grest-ts/schema"
import {USER_TOKEN_WIRE, USER_DATA, IsUserPermission, UserPermission, tUserId} from "../../../api/auth/UserAuth"
import {UserService} from "../services/UserService"

// Private to the server: the granted permissions for this request, stashed by process() and
// read by the lazy permissions() resolver. Not exported — handlers depend on USER_DATA only.
const USER_PERMS = new GGContextKey<UserPermission[]>("userPerms", IsArray(IsUserPermission))

// The whole inbound user-auth behaviour, written AT the wire (grep/ctrl+click both land here).
// .define() is process-global and frozen on first call; a second call throws. Replaces
// UserContextMiddleware + AuthGuard + the scopeResolver wiring.
export const USER_TOKEN_WIRE_HANDLER = USER_TOKEN_WIRE.define((users: UserService) => ({
    process: async () => {
        // USER_TOKEN_WIRE.get() returns the raw bearer token — readable only here.
        const payload = await users.verifyAccessToken(USER_TOKEN_WIRE.get())
        const user = users.getUserById(payload.sub as tUserId)
        if (!user) throw new NOT_AUTHORIZED({debugMessage: "User not found"})
        USER_DATA.set(user)
        USER_PERMS.set(payload.permissions)
    },
    permissions: async () => USER_PERMS.get()!,
}))
