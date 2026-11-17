import {GGConnectionSettingsKey, GGHttpSchema, GGRpc} from "@grest-ts/http"
import {GGContractClass, IsArray, IsNumber, IsObject, IsString, SERVER_ERROR} from "@grest-ts/schema"

/** Per-call dial target of the relay client, as kratt's hub sets for a workspace's relay. */
export const ADDRESSING_RELAY_CONN = new GGConnectionSettingsKey("addressingRelayConn")

export const AddressingRelayContract = new GGContractClass("AddressingRelayApi", {
    sync: {
        input: IsObject({branch: IsString}),
        success: IsObject({branch: IsString, by: IsString}),
        errors: [SERVER_ERROR],
    },
})

export const AddressingRelayApi = new GGHttpSchema({
    contract: AddressingRelayContract,
    pathPrefix: "api/addressing-relay",
    use: [ADDRESSING_RELAY_CONN],
    routes: {
        sync: GGRpc.POST("sync"),
    },
})

export const IsRelayTarget = IsObject({
    host: IsString,
    port: IsNumber,
    fingerprint256: IsString,
    ca: IsString.orUndefined,
})
export type RelayTarget = typeof IsRelayTarget.infer

/** Served plainly through discovery, so a test can learn where each relay's TLS server listens. */
export const AddressingRelayInfoContract = new GGContractClass("AddressingRelayInfoApi", {
    target: {
        success: IsRelayTarget,
        errors: [SERVER_ERROR],
    },
})

export const AddressingRelayInfoApi = new GGHttpSchema({
    contract: AddressingRelayInfoContract,
    pathPrefix: "api/addressing-relay-info",
    routes: {
        target: GGRpc.POST("target"),
    },
})

export const AddressingThirdPartyContract = new GGContractClass("AddressingThirdPartyApi", {
    createPull: {
        input: IsObject({head: IsString}),
        success: IsObject({number: IsNumber}),
        errors: [SERVER_ERROR],
    },
})

export const AddressingThirdPartyApi = new GGHttpSchema({
    contract: AddressingThirdPartyContract,
    pathPrefix: "repos",
    routes: {
        createPull: GGRpc.POST("pulls"),
    },
})

export const AddressingHubContract = new GGContractClass("AddressingHubApi", {
    sync: {
        input: IsObject({targets: IsArray(IsRelayTarget), branch: IsString}),
        success: IsArray(IsString),
        errors: [SERVER_ERROR],
    },
    syncWithoutTarget: {
        input: IsObject({branch: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
    openPull: {
        input: IsObject({head: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
    openPullAtRelativeUrl: {
        input: IsObject({head: IsString}),
        success: IsString,
        errors: [SERVER_ERROR],
    },
})

export const AddressingHubApi = new GGHttpSchema({
    contract: AddressingHubContract,
    pathPrefix: "api/addressing-hub",
    routes: {
        sync: GGRpc.POST("sync"),
        syncWithoutTarget: GGRpc.POST("sync-without-target"),
        openPull: GGRpc.POST("open-pull"),
        openPullAtRelativeUrl: GGRpc.POST("open-pull-at-relative-url"),
    },
})
