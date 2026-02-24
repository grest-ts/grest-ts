/**
 * Marker interface for external API services that can be mocked in tests.
 * When a class implements this interface, the test framework can intercept
 * all method calls and provide mock responses.
 *
 * Examples: REST APIs, GraphQL clients, third-party SDKs
 */
export interface GGMockableExternalApi {
    // Marker interface - no methods required
}

/**
 * Marker interface for database/storage services that can be mocked in tests.
 * When a class implements this interface, the test framework can intercept
 * all method calls and provide mock responses.
 *
 * Examples: Database clients, cache services, file storage
 */
export interface GGMockableDatabaseApi {
    // Marker interface - no methods required
}

