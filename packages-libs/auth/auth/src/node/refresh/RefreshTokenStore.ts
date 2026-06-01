import {IsInt, IsObject, IsString} from "@grest-ts/schema"
import {GGAuthSubject, IsGGAuthSubject} from "../../shared/tokenSchemas";

// Keyed by tokenHash = SHA-256(base64url) of the opaque token. The raw token is never
// stored, so a store leak can't be replayed. A schema so DB stores can .parse() rows.
export const IsRefreshTokenRecord = IsObject({
    tokenHash: IsString.nonEmpty,
    subject: IsGGAuthSubject,
    // Rotation lineage: a fresh id at login, inherited by every rotated child. Reuse
    // detection revokes by this, so one stolen token sinks only its own login session.
    familyId: IsString.nonEmpty,
    /** epoch ms */
    createdAt: IsInt.min(0),
    /** epoch ms */
    expiresAt: IsInt.min(0),
    // epoch ms, set when this token is rotated away. A live token is consumed by marking
    // it spent (not deleting), so a later replay of the same token is detectable as reuse.
    spentAt: IsInt.min(0).orUndefined,
})

export type RefreshTokenRecord = typeof IsRefreshTokenRecord.infer

// The revocation handle the stateless access JWT lacks. Rotation marks the old token
// spent rather than deleting it; re-presenting a spent token is reuse (caller revokes
// the family). markSpent is the atomic single-winner gate that keeps that race-safe.
export interface RefreshTokenStore {
    save(record: RefreshTokenRecord): Promise<void>

    find(tokenHash: string): Promise<RefreshTokenRecord | undefined>

    // Atomically transition a live token to spent. Returns true iff THIS call performed
    // the live->spent flip; false if it was already spent or absent — the caller treats
    // false as a reuse signal.
    markSpent(tokenHash: string, spentAt: number): Promise<boolean>

    revoke(tokenHash: string): Promise<void>

    // Revoke a whole rotation lineage (one login session) — used on reuse detection.
    revokeFamily(familyId: string): Promise<void>

    // "log out everywhere"
    revokeForSubject(subject: GGAuthSubject): Promise<void>
}
