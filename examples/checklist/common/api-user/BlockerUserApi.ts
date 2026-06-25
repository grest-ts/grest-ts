import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {GGContractClass, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsBlockUserRequest} from "../api-internal/BlockerApi";
import {GG_USER_AUTH_TOKEN} from "./auth/UserAuth";

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const BlockerUserApiContract = new GGContractClass("BlockerUserApi", {
    blockUser: {
        input: IsBlockUserRequest,
        success: undefined as undefined,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export const BlockerUserApi = new GGHttpSchema({
    contract: BlockerUserApiContract,
    pathPrefix: "api/blocker",
    use: [GG_USER_AUTH_TOKEN],
    routes: {
        blockUser: GGRpc.POST("blockUser")
    }
})
