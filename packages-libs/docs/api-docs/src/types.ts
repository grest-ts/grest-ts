import type {GGHttpSchema} from "@grest-ts/http";
import type {GGWebSocketSchema} from "@grest-ts/websocket";

/**
 * Schemas that belong to one logical group, organized by protocol.
 * A group can have HTTP schemas, WebSocket schemas, or both.
 */
export interface ApiDocsGroup {
    http?: GGHttpSchema<any, any>[];
    ws?: GGWebSocketSchema<any, any, any, any, any>[];
    description?: string;
}

/** Visual customization knobs that don't require replacing the shell. */
export interface ApiDocsBranding {
    logoUrl?: string;
    primaryColor?: string;
}

/** Shared options used by both live and static-build modes. */
export interface ApiDocsCommonOptions {
    title: string;
    version?: string;
    description?: string;

    /**
     * When set, sidebar shows groups; each group can have HTTP and/or WS schemas.
     * Mutually inclusive with the top-level `http`/`ws` shorthand — when both
     * are present, the shorthand becomes an additional implicit group named "API".
     */
    groups?: Record<string, ApiDocsGroup>;

    /** Convenience shorthand — ungrouped HTTP schemas. */
    http?: GGHttpSchema<any, any>[];

    /** Convenience shorthand — ungrouped WebSocket schemas. */
    ws?: GGWebSocketSchema<any, any, any, any, any>[];

    /** Which group opens by default. Defaults to first group key. */
    primary?: string;

    branding?: ApiDocsBranding;
}

/** One spec entry within a group as exposed by the manifest. */
export interface ApiDocsManifestSpec {
    /** Wire format — drives which embedded viewer is used in the shell. */
    type: "openapi" | "asyncapi";
    /** Sidebar label for this spec, e.g. "HTTP" / "WebSocket". */
    label: string;
    /** Relative URL where the spec JSON is served. */
    url: string;
}

/** One group as exposed by the manifest. */
export interface ApiDocsManifestGroup {
    name: string;
    slug: string;
    description?: string;
    specs: ApiDocsManifestSpec[];
}

/**
 * Manifest served at `${docsPath}/manifest.json`.
 * Drives the shell sidebar and is also passed into `customUi`.
 */
export interface ApiDocsManifest {
    title: string;
    version?: string;
    description?: string;
    primary?: string;
    groups: ApiDocsManifestGroup[];
    branding?: ApiDocsBranding;
}
