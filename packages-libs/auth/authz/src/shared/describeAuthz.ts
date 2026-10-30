import {type GGContractClass, type GGContractMethod, GGPermissionChecker} from "@grest-ts/schema"
import {expandActions, expandRoles} from "./chain"
import {definedAtOf} from "./defineAuthz"
import {GG_AUTHZ_APPROVAL_LEVELS, type GGAuthzApprovalLevel, type GGAuthzModel} from "./authzSchemas"

export interface GGAuthzDescribeOptions {
    contracts?: readonly GGContractClass<any>[]
}

export interface GGAuthzActionInfo {
    readonly name: string
    readonly description?: string
    readonly resourceTypes: readonly string[]
    readonly roles: readonly string[]
    readonly tokenScopes: readonly string[]
    readonly approvalFloor?: GGAuthzApprovalLevel
    /** `Contract.method` entries declaring this action. */
    readonly methods: readonly string[]
    readonly definedAt?: string
}

export interface GGAuthzRoleInfo {
    readonly name: string
    readonly description?: string
    readonly actions: readonly string[]
    readonly definedAt?: string
}

export interface GGAuthzCatalog {
    readonly actions: readonly GGAuthzActionInfo[]
    readonly roles: readonly GGAuthzRoleInfo[]
    readonly tokenScopes: readonly GGAuthzRoleInfo[]
}

export function describeAuthzModel(model: GGAuthzModel, options?: GGAuthzDescribeOptions): GGAuthzCatalog {
    const known = new Map(model.actions.map(a => [a.name, a]))
    const expanded = expandRoles(known, model.roles)
    const roles = model.roles.map(r => ({
        name: r.name,
        description: r.description,
        actions: [...expanded.get(r.name)!],
        definedAt: definedAtOf("role", r.name),
    }))
    const tokenScopes = (model.tokenScopes ?? []).map(s => ({
        name: s.name,
        description: s.description,
        actions: [...new Set(s.allow.flatMap(r => [...expandActions(known, r.actions)]))],
        definedAt: definedAtOf("token scope", s.name),
    }))
    const floors = (model.approvalFloor ?? []).map(f => ({actions: expandActions(known, f.actions), level: GG_AUTHZ_APPROVAL_LEVELS.indexOf(f.level)}))
    const methods = new Map<string, string[]>()
    for (const contract of options?.contracts ?? []) {
        for (const [name, method] of Object.entries<GGContractMethod>(contract.methods)) {
            const actions = GGPermissionChecker.requirementsOf(method.permission).map(r => r.action)
            for (const action of new Set(actions)) {
                if (!known.has(action)) throw new Error(`${contract.name}.${name} declares unknown action ${action}`)
                methods.set(action, [...methods.get(action) ?? [], `${contract.name}.${name}`])
            }
        }
    }
    return {
        actions: model.actions.map(a => {
            const floor = Math.max(-1, ...floors.filter(f => f.actions.has(a.name)).map(f => f.level))
            return {
                name: a.name,
                description: a.description,
                resourceTypes: a.resourceTypes,
                roles: roles.filter(r => r.actions.includes(a.name)).map(r => r.name),
                tokenScopes: tokenScopes.filter(s => s.actions.includes(a.name)).map(s => s.name),
                approvalFloor: floor < 0 ? undefined : GG_AUTHZ_APPROVAL_LEVELS[floor],
                methods: methods.get(a.name) ?? [],
                definedAt: definedAtOf("service", a.name.slice(0, a.name.indexOf(":"))),
            }
        }),
        roles,
        tokenScopes,
    }
}

export function documentAuthzModel(model: GGAuthzModel, options?: GGAuthzDescribeOptions): string {
    const catalog = describeAuthzModel(model, options)
    const row = (cells: readonly string[]) => `| ${cells.map(c => c.replace(/\|/g, "\\|")).join(" | ")} |`
    const list = (items: readonly string[]) => items.map(i => `\`${i}\``).join(", ")
    return [
        "## Actions",
        "",
        row(["Action", "Resource types", "Description", "Roles", "Token scopes", "Approval floor", "Methods"]),
        row(["---", "---", "---", "---", "---", "---", "---"]),
        ...catalog.actions.map(a => row([`\`${a.name}\``, list(a.resourceTypes), a.description ?? "", a.roles.join(", "), a.tokenScopes.join(", "), a.approvalFloor ?? "", list(a.methods)])),
        "",
        "## Roles",
        "",
        row(["Role", "Description", "Actions"]),
        row(["---", "---", "---"]),
        ...catalog.roles.map(r => row([r.name, r.description ?? "", list(r.actions)])),
        ...catalog.tokenScopes.length ? [
            "",
            "## Token scopes",
            "",
            row(["Scope", "Description", "Actions"]),
            row(["---", "---", "---"]),
            ...catalog.tokenScopes.map(s => row([s.name, s.description ?? "", list(s.actions)])),
        ] : [],
        "",
    ].join("\n")
}
