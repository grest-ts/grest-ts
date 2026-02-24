import {CodegenBuilder} from "./CodegenBuilder";

/**
 * Registry for codegen builders
 *
 * Builders register themselves when their module is imported.
 * Discovery happens via GGExtensionDiscovery('codegen').
 */
export class CodegenRegistry {
    private static builders: CodegenBuilder[] = []

    /**
     * Register a codegen builder
     */
    static register(builder: CodegenBuilder): void {
        // Avoid duplicate registration (use class name)
        if (this.builders.some(b => b.name === builder.name)) {
            return
        }
        this.builders.push(builder)
        console.log(`[Codegen] Registered builder: ${builder.name}`)
    }

    /**
     * Get all registered builders
     */
    static getBuilders(): CodegenBuilder[] {
        return this.builders
    }

    /**
     * Clear all registered builders (for testing)
     */
    static clear(): void {
        this.builders = []
    }
}