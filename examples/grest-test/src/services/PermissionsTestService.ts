import {FORBIDDEN} from "@grest-ts/schema"
import {AppPermission, TEST_SCOPES_DATA} from "../api/PermissionsApi"

export class PermissionsTestService {

    public anyAuth = async (): Promise<string> => "ok"

    public needsRead = async (): Promise<string> => "ok"

    public needsReadAndWrite = async (): Promise<string> => "ok"

    public needsReadOrAdmin = async (): Promise<string> => "ok"

    public nested = async (): Promise<string> => "ok"

    public checksInside = async ({label}: {label: string}): Promise<{label: string; branch: string}> => {
        // Gate already verified anyOf(Admin, Owner). Sub-check picks which branch
        // ran off the durable principal the wire minted in process().
        const scopes = TEST_SCOPES_DATA.get() ?? []
        if (scopes.includes(AppPermission.Admin)) return {label, branch: "admin"}
        if (scopes.includes(AppPermission.Owner)) return {label, branch: "owner"}
        // Unreachable: gate would have thrown FORBIDDEN already.
        throw new FORBIDDEN()
    }
}
