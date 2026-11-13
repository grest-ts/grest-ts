import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGContext, GGContextStore} from "@grest-ts/context"
import {GGRuntime} from "@grest-ts/runtime"
import {ERROR} from "@grest-ts/schema"
import {ADDRESSING_RELAY_CONN, AddressingHubApi, AddressingRelayApi, AddressingThirdPartyApi, RelayTarget} from "./api/AddressingApi"

// Module level on purpose: created when the module loads, before any runtime exists. Nothing listens there.
const thirdParty = AddressingThirdPartyApi.createClient({url: "http://127.0.0.7:4001/base/v2"})

const failed = (error: ERROR<string, unknown>) => `failed:${error.type}:${error.context?.displayMessage ?? ""}`

/** Addresses its own calls: a fixed URL for the third party, per-call connection settings for the relays. */
export class AddressingHubRuntime extends GGRuntime {
    public static readonly NAME = "addressingHub"

    protected compose(): void {
        const relay = AddressingRelayApi.createClient({url: ""})
        // A browser-style same-origin URL: nothing to dial from node.
        const sameOrigin = AddressingThirdPartyApi.createClient({url: "/api"})
        new GGHttp(new GGHttpServer()).http(AddressingHubApi, {
            sync: async ({targets, branch}: {targets: RelayTarget[], branch: string}) => {
                const by: string[] = []
                for (const {host, port, fingerprint256, ca} of targets) {
                    by.push(await new GGContext("relay-call", GGContextStore.tryGetContext()).run(() => {
                        ADDRESSING_RELAY_CONN.set({host, port, tlsPin: {fingerprint256}, ca})
                        return relay.sync({branch}).then(result => result.by, failed)
                    }))
                }
                return by
            },
            syncWithoutTarget: async ({branch}: {branch: string}) => relay.sync({branch}).then(result => result.by, failed),
            openPull: async ({head}: {head: string}) => thirdParty.createPull({head}).then(pull => "pull:" + pull.number, failed),
            openPullAtRelativeUrl: async ({head}: {head: string}) => sameOrigin.createPull({head}).then(pull => "pull:" + pull.number, failed),
        })
    }
}

AddressingHubRuntime.cli(import.meta.url).then()
