/**
 * Library Registry - Central registration of all benchmark libraries.
 *
 * Each library is registered with:
 * - name: Display name (must be unique)
 * - tags: Categories for filtering (aot, runtime, network)
 * - module: Path to the module (relative to this file)
 *
 * All libraries must use `export default` with a GGBenchTestCases object.
 * Libraries use dynamic imports so only the tested library is loaded.
 */

import {GGBenchTestCases} from "../lib/TestRunner";
import {LibraryTag} from "../constants";

// ============ Library Entry Definition ============

interface LibraryConfig {
    /** Unique display name */
    name: string;
    /** Tags for filtering/grouping */
    tags: LibraryTag[];
    /** Module path relative to this file */
    module: string;
}

export interface LibraryEntry extends LibraryConfig {
    /** Async loader - only imports when needed */
    loader: () => Promise<GGBenchTestCases>;
}

// ============ Library Configurations ============

const LIBRARY_CONFIGS: LibraryConfig[] = [
    // AOT-compiled libraries (pre-compiled validation)
    {name: "TypeBox+AOT", tags: ["aot", "val"], module: "./typebox/TypeBoxCompiled"},
    {name: "AJV+AOT", tags: ["aot", "val"], module: "./ajv/AjvAOT"},
    {name: "Typia (AOT)", tags: ["aot", "val"], module: "./typia/TypiaLibrary"},
    {name: "ts-runtime-checks", tags: [], module: "./ts-runtime-checks/TsRuntimeChecksLibrary"},  // No tag - limited functionality (first-error-only)
    {name: "@grest-ts/schema+AOT", tags: ["aot", "val"], module: "./gg-type/GGTypeAOT"},

    // JIT-compiled libraries (compile schema at import/first-use time)
    {name: "AJV+JIT", tags: ["runtime", "val"], module: "./ajv/AjvJIT"},

    // Runtime libraries (interpret schema at runtime)
    {name: "@grest-ts/schema", tags: ["runtime", "val"], module: "./gg-type/GGType"},
    {name: "Zod", tags: ["runtime", "val"], module: "./zod/ZodLibrary"},
    {name: "Valibot", tags: ["runtime", "val"], module: "./valibot/ValibotLibrary"},
    {name: "AJV", tags: ["runtime", "val"], module: "./ajv/Ajv"},
    {name: "TypeBox", tags: ["runtime", "val"], module: "./typebox/TypeBox"},
    {name: "Arktype", tags: ["runtime", "val"], module: "./arktype/ArktypeLibrary"},

    // Network/serialization libraries
    {name: "CBOR-X", tags: ["network"], module: "../network/CborXLibrary"},
    {name: "Msgpack", tags: ["network"], module: "../network/MsgpackLibrary"},
    {name: "Protobuf", tags: ["network"], module: "../network/ProtobufLibrary"},
    {name: "JSON", tags: ["network"], module: "../network/JsonBaselineLibrary"},
];

// ============ Build Registry with Loaders ============

export const LIBRARY_REGISTRY: LibraryEntry[] = LIBRARY_CONFIGS.map(config => ({
    ...config,
    loader: async () => (await import(config.module)).default
}));

// ============ Registry Helpers ============

/** Get library entry by name */
export function getLibrary(name: string): LibraryEntry | undefined {
    return LIBRARY_REGISTRY.find(lib => lib.name === name);
}

/** Get all library names */
export function getLibraryNames(): string[] {
    return LIBRARY_REGISTRY.map(lib => lib.name);
}

/** Filter libraries by tag */
export function getLibrariesByTag(tag: LibraryTag): LibraryEntry[] {
    return LIBRARY_REGISTRY.filter(lib => lib.tags.includes(tag));
}

/** Filter libraries by multiple tags (OR logic) */
export function getLibrariesByTags(tags: LibraryTag[]): LibraryEntry[] {
    return LIBRARY_REGISTRY.filter(lib => lib.tags.some(t => tags.includes(t)));
}

/** Load a library by name */
export async function loadLibrary(name: string): Promise<GGBenchTestCases> {
    const entry = getLibrary(name);
    if (!entry) {
        throw new Error(`Unknown library: ${name}. Available: ${getLibraryNames().join(", ")}`);
    }
    return entry.loader();
}

// ============ Tag Filter ============

export function resolveTagFilter(filter?: string): LibraryTag[] | undefined {
    if (!filter) return undefined;
    return [filter as LibraryTag];
}
