import type {AdapterConstructor} from "oidc-provider"

// oidc-provider model state (sessions, grants, codes, refresh tokens, registered clients,
// interactions). Payloads are opaque JSON owned by oidc-provider; expiry is enforced by the store.
export type GGOAuthPayload = Record<string, unknown> & {
    grantId?: string
    uid?: string
    accountId?: string
    consumed?: number
}

export interface GGOAuthStore {
    upsert(model: string, id: string, payload: GGOAuthPayload, expiresInSec: number | undefined): Promise<void>
    find(model: string, id: string): Promise<GGOAuthPayload | undefined>
    findByUid(model: string, uid: string): Promise<GGOAuthPayload | undefined>
    // Mark consumed (not delete): a second use of a code / rotated refresh token is detected as replay.
    // Must be atomic — throw oidc-provider's InvalidGrant if it was already consumed, so of two
    // concurrent redemptions one fails cleanly (a 5xx would be retried, and the retry is reuse).
    consume(model: string, id: string): Promise<void>
    destroy(model: string, id: string): Promise<void>
    // Every GRANT_BOUND row carrying this grantId.
    revokeByGrantId(grantId: string): Promise<void>
    // For "connected apps" and revoke-all.
    listGrantIds(accountId: string): Promise<string[]>
    destroySessions(accountId: string): Promise<void>
}

// What revoking a grant removes: oidc-provider's codes and tokens, and the server's own GrantUsage. An Interaction carries
// the grantId it would extend and must outlive it: another account finishing a sign-in first ends the old session
// (revoking its grants), then resumes the interaction.
export const GRANT_BOUND: ReadonlySet<string> = new Set(["AccessToken", "AuthorizationCode", "RefreshToken", "DeviceCode", "BackchannelAuthenticationRequest", "GrantUsage"])

// oidc-provider's adapter shape: `new Adapter(modelName)` per model.
export function toOidcAdapter(store: GGOAuthStore): AdapterConstructor {
    // oidc-provider revokes a grant through each grant-bound model at once; the store removes them all in one pass.
    const revoking = new Map<string, Promise<void>>()
    const revokeByGrantId = (grantId: string): Promise<void> => {
        let pending = revoking.get(grantId)
        if (!pending) {
            pending = store.revokeByGrantId(grantId).finally(() => revoking.delete(grantId))
            revoking.set(grantId, pending)
        }
        return pending
    }
    return class GGOAuthAdapter {
        private readonly model: string
        constructor(model: string) { this.model = model }
        upsert = (id: string, payload: GGOAuthPayload, expiresIn?: number) => store.upsert(this.model, id, payload, expiresIn)
        find = (id: string) => store.find(this.model, id)
        findByUid = (uid: string) => store.findByUid(this.model, uid)
        // Device flow is never enabled.
        findByUserCode = async () => undefined
        consume = (id: string) => store.consume(this.model, id)
        destroy = (id: string) => store.destroy(this.model, id)
        revokeByGrantId = revokeByGrantId
    }
}
