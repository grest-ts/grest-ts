import {FORBIDDEN} from "@grest-ts/schema"
import {GG_PERMISSIONS} from "@grest-ts/http"
import {AppPermission} from "../api/PermissionsApi"

export class PermissionsTestService {

    public publicMethod = async (): Promise<string> => {
        // Even on a public endpoint, GG_PERMISSIONS is populated when a
        // resolver is wired and identity is present — handlers can personalize.
        const perm = GG_PERMISSIONS.get()
        return perm ? "ok:authed" : "ok"
    }

    public anyAuth = async (): Promise<string> => "ok"

    public needsRead = async (): Promise<string> => "ok"

    public needsReadAndWrite = async (): Promise<string> => "ok"

    public needsReadOrAdmin = async (): Promise<string> => "ok"

    public nested = async (): Promise<string> => "ok"

    public checksInside = async ({label}: {label: string}): Promise<{label: string; branch: string}> => {
        // Gate already verified anyOf(Admin, Owner). Sub-check picks which branch
        // ran via the same checker the framework used.
        const perm = GG_PERMISSIONS.get()
        if (!perm) throw new FORBIDDEN()
        if (perm.has(AppPermission.Admin)) return {label, branch: "admin"}
        if (perm.has(AppPermission.Owner)) return {label, branch: "owner"}
        // Unreachable: gate would have thrown FORBIDDEN already.
        throw new FORBIDDEN()
    }
}
