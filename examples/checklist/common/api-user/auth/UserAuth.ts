import {IsObject, IsString} from "@grest-ts/schema";
import {GGHeader} from "@grest-ts/http";

export const IsUserAuthToken = IsString.brand("UserAuthToken");
export type tUserAuthToken = typeof IsUserAuthToken.infer

export const IsUserId = IsString.brand("UserId");
export type tUserId = typeof IsUserId.infer

export const IsUser = IsObject({
    id: IsUserId,
    username: IsString,
    email: IsString
})
export type User = typeof IsUser.infer

// Smart wire: `Authorization: Bearer <token>`. Verified server-side by GG_USER_AUTH_TOKEN_HANDLER
// (checklist/UserContext.ts) — the raw token is ephemeral; handlers read the durable principal
// from UserContext.
export const GG_USER_AUTH_TOKEN = new GGHeader("authorization", {scheme: "bearer"});
