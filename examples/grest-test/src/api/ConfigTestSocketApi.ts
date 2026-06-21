import {defineSocketContract, webSocketSchema} from "@grest-ts/websocket"
import {GGContractClient, GGContractImplementation, SERVER_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {IsConfigTestResponse} from "./ConfigTestApi";

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const ConfigTestSocketApiContract = defineSocketContract("ConfigTestSocketApi", {
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

export const ConfigTestSocketApi = webSocketSchema(ConfigTestSocketApiContract)
    .path("ws/config-test")
    .done()

// Type exports for use in services (implementation types return Promise)
export type ConfigTestSocketApiClientToServer = GGContractImplementation<typeof ConfigTestSocketApiContract.methods["clientToServer"]>
export type ConfigTestSocketApiServerToClient = GGContractClient<typeof ConfigTestSocketApiContract.methods["serverToClient"]>
