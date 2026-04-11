import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {GG_LOG} from "@grest-ts/logger"
import {GGLoggerConsole} from "@grest-ts/logger-console"
import {HelloApi} from "@newproject/api/api/HelloApi"
import {HelloApiImpl} from "./services/HelloApiImpl"
import {GreetingService} from "./services/GreetingService"

export class AppRuntime extends GGRuntime {

    public static readonly NAME = "app"

    protected compose(): void {
        GG_LOG.get().addLogger(new GGLoggerConsole({showData: true}))

        const httpServer = new GGHttpServer()

        const greetingService = new GreetingService()

        new GGHttp(httpServer)
            .http(HelloApi, new HelloApiImpl(greetingService))
    }
}

AppRuntime.cli(import.meta.url).then()
