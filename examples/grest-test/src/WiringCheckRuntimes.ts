import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {DupRouteApiA, DupRouteApiB, UnsatisfiableApi, WireConflictApi, WsDeadPushApi} from "./api/WiringCheckApi"

export class DupRouteRuntime extends GGRuntime {
    public static readonly NAME = "wiring-dup-route"
    protected compose(): void {
        new GGHttp(new GGHttpServer())
            .http(DupRouteApiA, {thing: async () => "ok"})
            .http(DupRouteApiB, {other: async () => "ok"})
    }
}

export class UnsatisfiableRuntime extends GGRuntime {
    public static readonly NAME = "wiring-unsatisfiable"
    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(UnsatisfiableApi, {needsScope: async () => "ok"})
    }
}

export class WireConflictRuntime extends GGRuntime {
    public static readonly NAME = "wiring-wire-conflict"
    protected compose(): void {
        new GGHttp(new GGHttpServer()).http(WireConflictApi, {hello: async () => "ok"})
    }
}

export class WsDeadPushRuntime extends GGRuntime {
    public static readonly NAME = "wiring-ws-dead-push"
    protected compose(): void {
        new GGHttp(new GGHttpServer())
            .ws(WsDeadPushApi, (incoming) => incoming.on({ping: async () => "ok"}))
    }
}

DupRouteRuntime.cli(import.meta.url)
UnsatisfiableRuntime.cli(import.meta.url)
WireConflictRuntime.cli(import.meta.url)
WsDeadPushRuntime.cli(import.meta.url)
