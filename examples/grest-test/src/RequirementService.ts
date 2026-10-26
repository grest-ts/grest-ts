import {FORBIDDEN, type GGRequirement, NOT_FOUND} from "@grest-ts/schema"
import {DOCS_AUTHORITY} from "./api/RequirementApi"
import {USER_DATA} from "./WireAuthService"

// `${user} ${action} ${type}/${id}` the authority allows.
const ALLOWED = new Set([
    "alice docs:Read docs:doc/d1",
    "alice docs:Write docs:doc/d1",
    "alice docs:Write docs:folder/f1",
    "bob docs:Write docs:doc/d1",
])

/** What the authority was asked, in order. The runtime runs inline in tests, so they read it directly. */
export const AUTHORITY_SEEN: string[] = []

export const DOCS_AUTHORITY_HANDLER = DOCS_AUTHORITY.define((seen: string[]) => ({
    authorize: async (r: GGRequirement, input: unknown) => {
        const fields = input as Record<string, string | undefined> | undefined
        seen.push(`${r.action} ${JSON.stringify(input ?? null)}`)
        if (r.list) return
        const fromInput = r.resource?.id && "field" in r.resource.id ? fields?.[r.resource.id.field] : undefined
        const resource = fromInput === undefined && r.createOn ? r.createOn : r.resource!
        const id = resource.id && "field" in resource.id ? fields?.[resource.id.field] : undefined
        if (ALLOWED.has(`${USER_DATA.get()!.username} ${r.action} ${resource.type}/${id}`)) return
        throw r.hidden ? new NOT_FOUND() : new FORBIDDEN()
    },
}))

export class RequirementDocsService {
    public read = async ({docId}: {docId: string}): Promise<string> => `read:${docId}`
    public publish = async ({docId}: {docId: string, text: string}): Promise<string> => `published:${docId}`
    public save = async ({docId, folderId}: {docId?: string, folderId: string}): Promise<string> => docId ? `updated:${docId}` : `created-in:${folderId}`
    public list = async (): Promise<string[]> => ["d1"]
}
