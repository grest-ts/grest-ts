export interface GGAuthzRnSegment {
    type: string
    id: string
}

export interface GGAuthzRnParts {
    partition: string
    service: string
    tenant: string
    path: GGAuthzRnSegment[]
}

const NAME = "[a-z][a-z0-9-]*"
const TENANT = "[A-Za-z0-9._-]*"
const ID = "[A-Za-z0-9._@+=,~-]+"
const PATH = `${NAME}/${ID}(?:/${NAME}/${ID})*`

export class GGAuthzRn {

    public static readonly REGEX = new RegExp(`^rn:${NAME}:${NAME}:${TENANT}:${PATH}$`)

    public static parse(rn: string): GGAuthzRnParts | undefined {
        if (!GGAuthzRn.REGEX.test(rn)) return undefined
        const [, partition, service, tenant, rest] = rn.split(":", 5) as [string, string, string, string, string]
        const parts = rest.split("/")
        const path: GGAuthzRnSegment[] = []
        for (let i = 0; i < parts.length; i += 2) path.push({type: parts[i]!, id: parts[i + 1]!})
        return {partition, service, tenant, path}
    }

    public static format(rn: GGAuthzRnParts): string {
        const formatted = `rn:${rn.partition}:${rn.service}:${rn.tenant}:${rn.path.map(s => `${s.type}/${s.id}`).join("/")}`
        if (!GGAuthzRn.REGEX.test(formatted)) throw new Error(`Invalid resource name: ${formatted}`)
        return formatted
    }

    /** `service:type` of the last path segment, e.g. `secrets:secret`. */
    public static type(rn: string): string | undefined {
        const parsed = GGAuthzRn.parse(rn)
        return parsed && `${parsed.service}:${parsed.path[parsed.path.length - 1]!.type}`
    }

    /** `=rn:…` matches that resource only, not what's under it. */
    public static isExact(value: string): boolean {
        return value.startsWith("=")
    }

    public static isPattern(value: string): boolean {
        return value.endsWith("*")
    }

    // A pattern is an RN prefix cut at a segment boundary plus `*`, so `workspace/w1*` can't also match `w10`.
    public static isValidPattern(pattern: string): boolean {
        if (!pattern.endsWith(":*") && !pattern.endsWith("/*")) return false
        const prefix = pattern.slice(0, -1)
        return !prefix.includes("*") && ["x", "x/x", "x:x/x", "x:x:x/x"].some(tail => GGAuthzRn.REGEX.test(prefix + tail))
    }
}
