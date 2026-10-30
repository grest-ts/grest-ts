import {generateKeyPairSync} from "node:crypto"
import {GGAuthAccessToken, JwksVerifier, JwsSigningStrategy, SecretJwsSigner} from "@grest-ts/auth"
import {GGContextKey} from "@grest-ts/context"
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {accessTokenJwksUrl, GGOAuthServer, GGOAuthServiceClient, InMemoryOAuthStore} from "@grest-ts/oauth"
import {GGRuntime} from "@grest-ts/runtime"
import {IsObject, IsString, NOT_AUTHORIZED} from "@grest-ts/schema"
import {SERVICE_TOKEN_WIRE, ServiceTokenApi, ServiceTokenCallerApi} from "./api/ServiceTokenApi"

const ISSUER = "http://auth.service-token.test"
const RESOURCE = "http://target.service-token.test"
const AUDIENCE = "service-token-target"
const CLIENT_ID = "caller"
const CLIENT_SECRET = "caller-secret"
const IsClaims = IsObject({})

export class ServiceTokenAuthRuntime extends GGRuntime {
    public static readonly NAME = "service-token-auth"

    protected compose(): void {
        const key = JSON.stringify(generateKeyPairSync("ec", {namedCurve: "P-256"}).privateKey.export({format: "jwk"}))
        const server = new GGHttpServer()
        new GGOAuthServer({
            issuer: () => ISSUER,
            store: new InMemoryOAuthStore(),
            secret: () => "service-token-auth-secret-0123456789",
            resources: [{
                resource: () => RESOURCE,
                accessToken: new GGAuthAccessToken({signer: new JwsSigningStrategy(new SecretJwsSigner(key)), claimSchema: IsClaims, audience: AUDIENCE, issuer: () => ISSUER}),
                scopes: ["internal"],
                clients: "service",
                claims: async () => ({}),
            }],
            interactionPage: async () => undefined,
            serviceClients: () => [{clientId: CLIENT_ID, secret: () => CLIENT_SECRET}],
        }).mount(server)
    }
}

const CALLER = new GGContextKey("serviceTokenCaller", IsString)
const accessToken = new GGAuthAccessToken({signer: new JwksVerifier({jwks: accessTokenJwksUrl()}), claimSchema: IsClaims, audience: AUDIENCE, issuer: () => ISSUER})
const SERVICE_TOKEN_HANDLER = SERVICE_TOKEN_WIRE.define(() => ({
    process: async () => {
        const token = SERVICE_TOKEN_WIRE.get()
        if (!token) throw new NOT_AUTHORIZED()
        CALLER.set((await accessToken.verify(token)).sub)
    },
    permissions: async () => [],
}))

export class ServiceTokenTargetRuntime extends GGRuntime {
    public static readonly NAME = "service-token-target"

    protected compose(): void {
        SERVICE_TOKEN_HANDLER.create(undefined)
        new GGHttp(new GGHttpServer()).http(ServiceTokenApi, {whoami: async () => CALLER.get()!})
    }
}

export class ServiceTokenCallerRuntime extends GGRuntime {
    public static readonly NAME = "service-token-caller"

    protected compose(): void {
        const oauth = new GGOAuthServiceClient({clientId: CLIENT_ID, secret: () => CLIENT_SECRET})
        const target = ServiceTokenApi.createClient({wires: [{wire: SERVICE_TOKEN_WIRE, value: () => oauth.token(RESOURCE)}]})
        new GGHttp(new GGHttpServer()).http(ServiceTokenCallerApi, {callTarget: async () => await target.whoami()})
    }
}

ServiceTokenAuthRuntime.cli(import.meta.url)
ServiceTokenTargetRuntime.cli(import.meta.url)
ServiceTokenCallerRuntime.cli(import.meta.url)
