import {webSocketSchema} from "@grest-ts/websocket"
import {GGContractClient, GGContractImplementation, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsConfigTestResponse} from "./ConfigTestApi";

const ConfigTestSocketApiMethods = {
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
}

export const ConfigTestSocketApi = webSocketSchema("ConfigTestSocketApi")
    .path("ws/config-test")
    .messages(ConfigTestSocketApiMethods)

// Type exports for use in services (implementation types return Promise)
export type ConfigTestSocketApiClientToServer = GGContractImplementation<typeof ConfigTestSocketApiMethods["clientToServer"]>
export type ConfigTestSocketApiServerToClient = GGContractClient<typeof ConfigTestSocketApiMethods["serverToClient"]>
