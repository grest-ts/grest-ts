import {GGConfig, GGConfigLocator, GGConfigStoreLocal, GGSecret, createLocalConfig} from "@grest-ts/config"
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGRuntime} from "@grest-ts/runtime"
import {IsString} from "@grest-ts/schema"
import {GGSharedSecret} from "@grest-ts/service-auth"
import {INTERNAL_SECRET_WIRE, SharedSecretApi, SharedSecretCallerApi} from "./api/SharedSecretApi"

export const SharedSecretConfig = GGConfig.define("/shared_secret_test/", () => ({
    settings: {
        secret: new GGSecret("secret", IsString, "What SharedSecretApi expects"),
        callerSecret: new GGSecret("caller_secret", IsString, "What the caller's right-secret client sends"),
        wrongSecret: new GGSecret("wrong_secret", IsString, "What the caller's wrong-secret client sends"),
    }
}))

export const SHARED_SECRET_HANDLER = GGSharedSecret.verify(INTERNAL_SECRET_WIRE)

function compose(secret: string): void {
    const settings = SharedSecretConfig.settings
    new GGConfigLocator(SharedSecretConfig)
        .add(GGSecret, new GGConfigStoreLocal(SharedSecretConfig, createLocalConfig(SharedSecretConfig, {
            settings: {secret, callerSecret: "s3cret", wrongSecret: "s3cret-but-longer"},
        })))
    SHARED_SECRET_HANDLER.create(settings.secret)

    const right = SharedSecretApi.createClient({wires: [GGSharedSecret.attach(INTERNAL_SECRET_WIRE, settings.callerSecret)]})
    const wrong = SharedSecretApi.createClient({wires: [GGSharedSecret.attach(INTERNAL_SECRET_WIRE, settings.wrongSecret)]})
    new GGHttp(new GGHttpServer())
        .http(SharedSecretApi, {ping: async () => "pong"})
        .http(SharedSecretCallerApi, {
            withRightSecret: async () => await right.ping(),
            withWrongSecret: async () => await wrong.ping(),
        })
}

export class SharedSecretRuntime extends GGRuntime {
    public static readonly NAME = "shared-secret"

    protected compose(): void {
        compose("s3cret")
    }
}

export class SharedSecretUnconfiguredRuntime extends GGRuntime {
    public static readonly NAME = "shared-secret-unconfigured"

    protected compose(): void {
        compose("")
    }
}

SharedSecretRuntime.cli(import.meta.url)
SharedSecretUnconfiguredRuntime.cli(import.meta.url)
