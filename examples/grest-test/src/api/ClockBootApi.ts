import {GGHttpSchema, GGRpc} from "@grest-ts/http"
import {GGContractClass, IsNumber, SERVER_ERROR} from "@grest-ts/schema"

function clockBootApi(name: string) {
    return new GGHttpSchema({
        contract: new GGContractClass(`ClockBoot${name}`, {
            boot: {
                success: IsNumber,
                errors: [SERVER_ERROR],
            },
        }),
        pathPrefix: `api/clock-boot-${name.toLowerCase()}`,
        routes: {
            boot: GGRpc.GET("boot"),
        },
    })
}

export const ClockBootWorkerApi = clockBootApi("Worker")
export const ClockBootIsolatedApi = clockBootApi("Isolated")
