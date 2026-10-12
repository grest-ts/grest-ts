import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {FORBIDDEN} from "@grest-ts/schema"
import {InterceptorApi} from "./api/InterceptorApi"

class InterceptorImpl {
    public plain = async ({text}: {text: string}) => text
    public shout = async ({text}: {text: string}) => text
    public denied = async ({text}: {text: string}) => text
}

export class InterceptorRuntime extends GGRuntime {
    public static readonly NAME = "interceptor"

    protected compose(): void {
        const httpServer = new GGHttpServer()
            .intercept(async (call, next) => `outer(${await next(call.input)})`)
            .intercept(async (call, next) => {
                if (call.contract.meta?.deny) throw new FORBIDDEN({debugMessage: `${call.api}.${call.method} denied`})
                const input = call.input as {text: string}
                const result = await next(call.contract.meta?.upperCaseInput ? {text: input.text.toUpperCase()} : input)
                return `inner(${result})`
            })
        new GGHttp(httpServer).http(InterceptorApi, new InterceptorImpl())
    }
}

InterceptorRuntime.cli(import.meta.url).then()
