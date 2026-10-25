export const RESOURCE_METADATA = "/.well-known/oauth-protected-resource"

// RFC 9728: a resource's metadata sits at its URL's path under the well-known prefix.
export function resourceMetadataPath(resource: string): string {
    const path = new URL(resource).pathname
    return RESOURCE_METADATA + (path === "/" ? "" : path)
}

export function resourceMetadataUrl(resource: string): string {
    return new URL(resource).origin + resourceMetadataPath(resource)
}
