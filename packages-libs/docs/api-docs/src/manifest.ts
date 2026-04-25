import type {GGHttpSchema} from "@grest-ts/http";
import type {GGWebSocketSchema} from "@grest-ts/websocket";
import type {ApiDocsCommonOptions, ApiDocsGroup, ApiDocsManifest, ApiDocsManifestGroup} from "./types";

/**
 * Resolve the user's options into a normalized list of groups.
 * Top-level `http`/`ws` shorthand becomes an implicit "API" group when no
 * `groups` are supplied; when `groups` are supplied as well, the shorthand
 * is appended as an extra group named "API" so nothing silently disappears.
 */
export function resolveGroups(options: Pick<ApiDocsCommonOptions, "groups" | "http" | "ws">): Array<{name: string, group: ApiDocsGroup}> {
    const explicit = options.groups
        ? Object.entries(options.groups).map(([name, group]) => ({name, group}))
        : [];
    const shorthand = (options.http?.length || options.ws?.length)
        ? [{name: explicit.length > 0 ? "API" : "API", group: {http: options.http, ws: options.ws}}]
        : [];
    if (explicit.length === 0 && shorthand.length === 0) {
        throw new Error("@grest-ts/api-docs: no schemas given. Pass `groups`, `http`, or `ws`.");
    }
    if (explicit.length > 0 && shorthand.length > 0) {
        return [...explicit, ...shorthand];
    }
    return explicit.length > 0 ? explicit : shorthand;
}

/** Convert a human-readable group name into a URL-safe slug. */
export function toSlug(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        || "group";
}

/**
 * Build the manifest used by both the live shell and the static build output.
 *
 * @param options  user-facing options (title, groups, branding, …)
 * @param baseUrl  prefix prepended to spec URLs in the manifest. For live
 *                 mode this is the absolute docs path (e.g. "/docs"). For
 *                 static build it's "" so the shell uses relative URLs.
 */
export function buildManifest(
    options: ApiDocsCommonOptions,
    baseUrl: string
): ApiDocsManifest {
    const resolved = resolveGroups(options);

    if (options.primary !== undefined && !resolved.some(g => g.name === options.primary)) {
        throw new Error(`@grest-ts/api-docs: \`primary\` must be a group name (got ${JSON.stringify(options.primary)}, available: ${resolved.map(g => g.name).join(", ")}).`);
    }

    const usedSlugs = new Set<string>();
    const groups: ApiDocsManifestGroup[] = resolved.map(({name, group}) => {
        const slug = toSlug(name);
        if (usedSlugs.has(slug)) {
            throw new Error(`@grest-ts/api-docs: group names produce duplicate slug "${slug}". Rename to disambiguate: ${[...usedSlugs, slug].join(", ")}`);
        }
        usedSlugs.add(slug);

        const specs: ApiDocsManifestGroup["specs"] = [];
        if (group.http && group.http.length > 0) {
            specs.push({type: "openapi", label: "HTTP", url: `${baseUrl}/specs/${slug}/openapi.json`});
        }
        if (group.ws && group.ws.length > 0) {
            specs.push({type: "asyncapi", label: "WebSocket", url: `${baseUrl}/specs/${slug}/asyncapi.json`});
        }
        if (specs.length === 0) {
            throw new Error(`@grest-ts/api-docs: group "${name}" has no http or ws schemas.`);
        }

        return {name, slug, ...(group.description ? {description: group.description} : {}), specs};
    });

    return {
        title: options.title,
        ...(options.version !== undefined ? {version: options.version} : {}),
        ...(options.description !== undefined ? {description: options.description} : {}),
        ...(options.primary !== undefined ? {primary: options.primary} : {}),
        groups,
        ...(options.branding !== undefined ? {branding: options.branding} : {}),
    };
}

/**
 * Look up a group's HTTP schemas, used when serving an OpenAPI spec.
 * Returns undefined if the group has no HTTP schemas.
 */
export function findGroupHttpSchemas(
    options: Pick<ApiDocsCommonOptions, "groups" | "http" | "ws">,
    groupName: string
): GGHttpSchema<any, any>[] | undefined {
    for (const {name, group} of resolveGroups(options)) {
        if (name === groupName) return group.http;
    }
    return undefined;
}

/** Same for WebSocket schemas → AsyncAPI spec. */
export function findGroupWsSchemas(
    options: Pick<ApiDocsCommonOptions, "groups" | "http" | "ws">,
    groupName: string
): GGWebSocketSchema<any, any, any, any, any>[] | undefined {
    for (const {name, group} of resolveGroups(options)) {
        if (name === groupName) return group.ws;
    }
    return undefined;
}
