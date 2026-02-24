/**
 * Shared constants for the benchmark system.
 * Centralizes test categories, test types, and other repeated values.
 */

// ============ Test Categories ============

export enum TestCategory {
    number = "number",
    simple = "simple",
    nested = "nested",
    refine = "refine",
    discriminated = "discriminated",
    recursive = "recursive",
    tuple = "tuple",
    bigString = "bigString",
    bigArray = "bigArray"
}

export const TEST_CATEGORIES = Object.values(TestCategory);

// ============ Test Types (for benchmarks) ============

export enum TestType {
    startup = "startup",
    is_correct = "is_correct",
    is_wrong = "is_wrong",
    parse_correct = "parse_correct",
    parse_wrong = "parse_wrong",
    string_correct = "string_correct",
    string_wrong = "string_wrong",
    stringify_correct = "stringify_correct",
    stringify_wrong = "stringify_wrong"
}

export const BENCHMARK_TEST_TYPES = [
    TestType.is_correct,
    TestType.is_wrong,
    TestType.parse_correct,
    TestType.parse_wrong,
    TestType.string_correct,
    TestType.string_wrong,
    TestType.stringify_correct,
    TestType.stringify_wrong,
] as const;

// Test type metadata for display
export const TEST_TYPE_INFO: Record<TestType, { name: string; section: string }> = {
    [TestType.startup]: {name: "STARTUP TIME", section: "STARTUP"},
    [TestType.is_correct]: {name: "IS - Valid", section: "VALIDATION"},
    [TestType.is_wrong]: {name: "IS - Invalid", section: "VALIDATION"},
    [TestType.parse_correct]: {name: "PARSE - Valid", section: "VALIDATION"},
    [TestType.parse_wrong]: {name: "PARSE - Invalid", section: "VALIDATION"},
    [TestType.string_correct]: {name: "STRING - Valid", section: "VALIDATION"},
    [TestType.string_wrong]: {name: "STRING - Invalid", section: "VALIDATION"},
    [TestType.stringify_correct]: {name: "STRINGIFY - Valid", section: "VALIDATION"},
    [TestType.stringify_wrong]: {name: "STRINGIFY - Invalid", section: "VALIDATION"},
};

// ============ Library Tags ============

export const LIBRARY_TAGS = ["aot", "runtime", "network", "val"] as const;

export type LibraryTag = typeof LIBRARY_TAGS[number];

// ============ Test Data Imports ============

// ============ Filter Helpers ============

export function filterTestTypes(filter?: string): TestType[] {
    if (!filter) return [...BENCHMARK_TEST_TYPES];
    const lowerFilter = filter.toLowerCase();
    return BENCHMARK_TEST_TYPES.filter(t => t.toLowerCase().startsWith(lowerFilter));
}
