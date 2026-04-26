import {GGContractClass, IsObject, IsString, IsArray, SERVER_ERROR} from "@grest-ts/schema"
import {IsFile} from "@grest-ts/schema-file"
import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGFileUpload} from "@grest-ts/http-file"
import {UNAUTHORIZED, NOT_FOUND, ALREADY_EXISTS} from "./errors"
import {IsUser, IsUserId} from "./schemas"
import {GG_USER_TOKEN} from "../auth/AuthContext"

const IsUserIdRequest = IsObject({
    userId: IsUserId,
})

const IsCreateUserRequest = IsObject({
    username: IsString,
    password: IsString,
})

const IsUpdateUserRequest = IsObject({
    userId: IsUserId,
    username: IsString,
    password: IsString.orUndefined,
})

const IsSetClaudeCredentialsRequest = IsObject({
    credentials: IsFile.accept(".json"),
})

const IsSetClaudeConfigRequest = IsObject({
    config: IsString,
})

export const UserApiContract = new GGContractClass("UserApi", {
    list: {
        success: IsArray(IsUser),
        errors: [UNAUTHORIZED, SERVER_ERROR],
    },
    get: {
        input: IsUserIdRequest,
        success: IsUser,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    create: {
        input: IsCreateUserRequest,
        success: IsUser,
        errors: [UNAUTHORIZED, ALREADY_EXISTS, SERVER_ERROR],
    },
    update: {
        input: IsUpdateUserRequest,
        success: IsUser,
        errors: [UNAUTHORIZED, NOT_FOUND, ALREADY_EXISTS, SERVER_ERROR],
    },
    delete: {
        input: IsUserIdRequest,
        errors: [UNAUTHORIZED, NOT_FOUND, SERVER_ERROR],
    },
    /** Upload Claude CLI credentials (.credentials.json). Encrypted at rest, pushed to VMs on credential sync. */
    setClaudeCredentials: {
        input: IsSetClaudeCredentialsRequest,
        errors: [UNAUTHORIZED, SERVER_ERROR],
    },
    /** Set Claude CLI config (.claude.json). Editable online. mcpServers stripped before storage. */
    setClaudeConfig: {
        input: IsSetClaudeConfigRequest,
        errors: [UNAUTHORIZED, SERVER_ERROR],
    },
})

export const UserApi = httpSchema(UserApiContract)
    .pathPrefix("api")
    .use(GG_USER_TOKEN)
    .routes({
        list: GGRpc.GET("users"),
        get: GGRpc.POST("users/get"),
        create: GGRpc.POST("users"),
        update: GGRpc.POST("users/update"),
        delete: GGRpc.POST("users/delete"),
        setClaudeCredentials: GGFileUpload.POST("users/set-claude-credentials"),
        setClaudeConfig: GGRpc.POST("users/set-claude-config"),
    })
