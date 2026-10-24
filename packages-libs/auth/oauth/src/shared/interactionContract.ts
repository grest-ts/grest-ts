import {FORBIDDEN, GG_NO_PERMISSIONS, GGContractClass, IsArray, IsBoolean, IsObject, IsString, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR} from "@grest-ts/schema"

export const IsGGOAuthInteractionClient = IsObject({
    clientId: IsString,
    name: IsString,
    /** Pre-registered by the app (its own UI/CLI). Third-party clients must be shown a consent screen. */
    firstParty: IsBoolean,
    /** Hosts the authorization code is sent to — show these on the consent screen. */
    redirectHosts: IsArray(IsString),
    /** Every redirect is a loopback address: any local process could be posing as this client. */
    loopbackOnly: IsBoolean,
})
export type GGOAuthInteractionClient = typeof IsGGOAuthInteractionClient.infer

export const IsGGOAuthInteraction = IsObject({
    uid: IsString,
    client: IsGGOAuthInteractionClient,
    scopes: IsArray(IsString),
    /** The resource (API) the client asks for access to. */
    resource: IsString,
})
export type GGOAuthInteraction = typeof IsGGOAuthInteraction.infer

const IsUid = IsObject({uid: IsString.nonEmpty})
/** Where the browser must navigate next: back to the authorization server, which finishes the flow. */
const IsRedirect = IsObject({redirectUrl: IsString})

/**
 * The app's login/consent page talks to this. Bind it with the app's own user wire — the
 * signed-in user becomes the OAuth subject — e.g.
 *   new GGHttpSchema({contract: GGOAuthInteractionContract, pathPrefix: "api/oauth/interaction", use: [USER_WIRE], routes: {...}})
 */
export const GGOAuthInteractionContract = new GGContractClass("GGOAuthInteraction", {
    get: {input: IsUid, success: IsGGOAuthInteraction, errors: [NOT_FOUND, NOT_AUTHORIZED, SERVER_ERROR], permission: GG_NO_PERMISSIONS},
    /** The signed-in user approves: the browser then follows redirectUrl to receive the code. */
    approve: {input: IsUid, success: IsRedirect, errors: [NOT_FOUND, NOT_AUTHORIZED, FORBIDDEN, SERVER_ERROR], permission: GG_NO_PERMISSIONS},
    /** The user declines: the client receives access_denied. */
    deny: {input: IsUid, success: IsRedirect, errors: [NOT_FOUND, NOT_AUTHORIZED, SERVER_ERROR], permission: GG_NO_PERMISSIONS},
})
