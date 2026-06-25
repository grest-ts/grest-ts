import {GGWebSocketSchema} from "@grest-ts/websocket"
import {GGDuplexContract, SERVER_ERROR, GG_NO_PERMISSIONS} from "@grest-ts/schema";
import {IsConfigTestResponse} from "./ConfigTestApi";

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ConfigTestSocketApiContract = new GGDuplexContract("ConfigTestSocketApi", {
    connect: {errors: [SERVER_ERROR]},
    clientToServer: {
        getWatchedValue: {
            success: IsConfigTestResponse,
            errors: [SERVER_ERROR],
            permission: GG_NO_PERMISSIONS
        }
    },
    serverToClient: {
        configChanged: {
            input: IsConfigTestResponse,
            permission: GG_NO_PERMISSIONS
        }
    }
})

export const ConfigTestSocketApi = new GGWebSocketSchema({
    contract: ConfigTestSocketApiContract,
    path: "ws/config-test",
})
