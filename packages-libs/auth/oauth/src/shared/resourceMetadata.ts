export const RESOURCE_METADATA = "/.well-known/oauth-protected-resource"

// RFC 9728: a resource's metadata sits at its URL's path under the well-known prefix.
export function resourceMetadataPath(resource: string): string {
    const path = new URL(resource).pathname
    return RESOURCE_METADATA + (path === "/" ? "" : path)
}

// A resource's own URL and every URL under it (e.g. /mcp/<label>) are resources of it, each one its own
// audience; the innermost resource answers. `of` reads the identifier compared against.
export function innermostResource<R>(resources: R[], url: string, of: (resource: R) => string): R | undefined {
    return resources
        .filter(r => `${url}/`.startsWith(`${of(r).replace(/\/$/, "")}/`))
        .sort((a, b) => of(b).length - of(a).length)[0]
}

export function resourceMetadataUrl(resource: string): string {
    return new URL(resource).origin + resourceMetadataPath(resource)
}
