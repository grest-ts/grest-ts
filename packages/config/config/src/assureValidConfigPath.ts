/**
 * Validates config key name for compatibility with external providers.
 * Rules:
 * - Must start with forward slash
 * - Only letters, numbers, underscore, forward slash allowed
 * - Each segment (word) must start with a letter
 * - No double slashes
 * - Cannot end with slash
 * - Max 2048 characters (AWS limit)
 */
export function assureValidConfigPath(path: string) {
    if (path.length > 2048) {
        throw new Error(`Config key name exceeds 2048 characters: ${path}`);
    }
    if (!path.startsWith('/')) {
        throw new Error(`Config key name must start with '/': ${path}`);
    }
    if (path.endsWith('/')) {
        throw new Error(`Config key name cannot end with '/': ${path}`);
    }
    if (path.includes('//')) {
        throw new Error(`Config key name cannot contain '//': ${path}`);
    }
    if (!/^[a-zA-Z0-9_\/]+$/.test(path)) {
        throw new Error(`Config key name contains invalid characters (allowed: a-z, A-Z, 0-9, _, /): ${path}`);
    }
    // Each segment must start with a letter
    const segments = path.split('/').filter(s => s.length > 0);
    for (const segment of segments) {
        if (!/^[a-zA-Z]/.test(segment)) {
            throw new Error(`Each path segment must start with a letter: ${path}`);
        }
    }
}