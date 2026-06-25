import {GGHeader, GGRpc, GGHttpSchema} from "@grest-ts/http"
import {GGWebSocketSchema} from "@grest-ts/websocket"
import {FORBIDDEN, GGContractClass, GGDuplexContract, IsString, NOT_AUTHORIZED, SERVER_ERROR} from "@grest-ts/schema"

// --- #2 duplicate route: two schemas resolve to the same method + path -------------------------
const DupRouteContractA = new GGContractClass("DupRouteA", {
    thing: {success: IsString, errors: [SERVER_ERROR]},
})
const DupRouteContractB = new GGContractClass("DupRouteB", {
    other: {success: IsString, errors: [SERVER_ERROR]},
})
export const DupRouteApiA = new GGHttpSchema({
    contract: DupRouteContractA,
    pathPrefix: "api/dup",
    routes: {thing: GGRpc.GET("same")},
})
export const DupRouteApiB = new GGHttpSchema({
    contract: DupRouteContractB,
    pathPrefix: "api/dup",
    routes: {other: GGRpc.GET("same")},
})

// --- #1 unsatisfiable: a route needs a real permission but the schema .use()s no wire ----------
const UnsatisfiableContract = new GGContractClass("Unsatisfiable", {
    needsScope: {
        success: IsString,
        errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR],
        permission: "needs:scope",
    },
})
export const UnsatisfiableApi = new GGHttpSchema({
    contract: UnsatisfiableContract,
    pathPrefix: "api/unsatisfiable",
    routes: {needsScope: GGRpc.GET("read")},
})

// --- #3/#4 wire conflict: two wires on one schema share a context-key name + header ------------
const WireConflictContract = new GGContractClass("WireConflict", {
    hello: {success: IsString, errors: [SERVER_ERROR]},
})
export const WireConflictApi = new GGHttpSchema({
    contract: WireConflictContract,
    pathPrefix: "api/wire-conflict",
    use: [new GGHeader("x-token"), new GGHeader("x-token")],
    routes: {hello: GGRpc.GET("hello")},
})

// --- #5 dead serverToClient permission: gate can't enforce server-pushed messages -------------
const WsDeadPushContract = new GGDuplexContract("WsDeadPush", {
    connect: {errors: [SERVER_ERROR]},
    clientToServer: {
        ping: {success: IsString, errors: [SERVER_ERROR]},
    },
    serverToClient: {
        push: {input: IsString, errors: [NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: "push:scope"},
    },
})
export const WsDeadPushApi = new GGWebSocketSchema({
    contract: WsDeadPushContract,
    path: "ws/dead-push",
})
