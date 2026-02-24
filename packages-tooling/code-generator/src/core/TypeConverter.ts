/**
 * TypeConverter - Abstract base class for converting TypeScript types to different representations
 *
 * This class provides a unified visitor pattern for walking the ParsedType tree.
 * Subclasses implement the conversion to specific output formats:
 * - JsonSchemaGenerator: TypeScript → JSON Schema
 * - ValidatorGenerator: TypeScript → Runtime validator code
 *
 * Future converters could include:
 * - GraphQL schema generator
 * - Protocol Buffer definitions
 * - OpenRPC schemas
 * - etc.
 *
 * The base class handles:
 * - Common type pattern detection (primitives, arrays, inline objects)
 * - Tree walking via visitor pattern
 * - Type classification utilities
 */

import {ParsedType, PropertyInfo} from './ParsedType'
import {TypeExtractor} from './TypeExtractor'

/**
 * Abstract base class for type converters
 * @template TOutput - The output type (e.g., 'any' for JSON Schema, 'string' for validator code)
 */
export abstract class TypeConverter<TOutput> {
    protected readonly typeExtractor: TypeExtractor

    constructor(typeExtractor: TypeExtractor) {
        this.typeExtractor = typeExtractor
    }

    // ============================================================================
    // Type Classification Utilities (shared across all converters)
    // ============================================================================

    /**
     * Check if a type is a primitive TypeScript type
     */
    static isPrimitiveType(typeName: string): boolean {
        return ['string', 'number', 'boolean', 'any', 'void', 'undefined', 'unknown', 'null'].includes(typeName)
    }

    /**
     * Check if a type is void or undefined
     */
    static isVoidType(typeName: string): boolean {
        return typeName === 'void' || typeName === 'undefined'
    }

    /**
     * Check if a type string represents an array (ends with [])
     */
    static isArrayType(typeName: string): boolean {
        return typeName.endsWith('[]')
    }

    /**
     * Extract the element type from an array type string
     * Example: "string[]" -> "string"
     */
    static extractArrayElementType(typeName: string): string {
        return typeName.slice(0, -2)
    }

    /**
     * Check if a type string is an inline object definition
     * Example: "{ name: string, age: number }"
     */
    static isInlineObjectType(typeName: string): boolean {
        return typeName.trim().startsWith('{')
    }

    /**
     * Check if a type string is a union (contains |)
     */
    static isUnionType(typeName: string): boolean {
        return typeName.includes('|')
    }

    // ============================================================================
    // Main Conversion Entry Point
    // ============================================================================

    /**
     * Convert a type name to the target representation
     * This is the main entry point for conversion
     */
    abstract convert(typeName: string): TOutput

    // ============================================================================
    // ParsedType Visitor Pattern (subclasses implement these)
    // ============================================================================

    /**
     * Convert a fully parsed type to the target representation
     * Dispatches to specific visit methods based on type.kind
     */
    protected convertParsedType(type: ParsedType): TOutput {
        switch (type.kind) {
            case 'primitive':
                return this.visitPrimitive(type)

            case 'branded':
                return this.visitBranded(type)

            case 'interface':
            case 'type':
                return this.visitInterface(type)

            case 'enum':
                return this.visitEnum(type)

            case 'union':
                return this.visitUnion(type)

            case 'array':
                return this.visitArray(type)

            case 'literal':
                return this.visitLiteral(type)

            case 'class':
                return this.visitClass(type)

            default:
                return this.visitUnknown(type)
        }
    }

    // ============================================================================
    // Abstract Visitor Methods (subclasses MUST implement)
    // ============================================================================

    /**
     * Visit a primitive type (string, number, boolean, etc.)
     */
    protected abstract visitPrimitive(type: ParsedType): TOutput

    /**
     * Visit a branded type (e.g., type UserId = string & Brand<'UserId'>)
     */
    protected abstract visitBranded(type: ParsedType): TOutput

    /**
     * Visit an interface or type alias
     */
    protected abstract visitInterface(type: ParsedType): TOutput

    /**
     * Visit an enum type
     */
    protected abstract visitEnum(type: ParsedType): TOutput

    /**
     * Visit a union type (A | B | C)
     */
    protected abstract visitUnion(type: ParsedType): TOutput

    /**
     * Visit an array type
     */
    protected abstract visitArray(type: ParsedType): TOutput

    /**
     * Visit a literal type (e.g., "success", 42, true)
     */
    protected abstract visitLiteral(type: ParsedType): TOutput

    /**
     * Visit a class type (optional - subclasses can override)
     * Default: treat as interface
     */
    protected visitClass(type: ParsedType): TOutput {
        return this.visitInterface(type)
    }

    /**
     * Visit an unknown/unhandled type (fallback)
     */
    protected abstract visitUnknown(type: ParsedType): TOutput

    // ============================================================================
    // Optional Helper Methods (subclasses can override if needed)
    // ============================================================================

    /**
     * Convert a property to the target representation
     * Default implementation delegates to convertParsedType
     */
    protected convertProperty(propInfo: PropertyInfo): TOutput {
        // If property has a full ParsedType structure, convert it
        if (propInfo.kind) {
            return this.convertParsedType(propInfo as unknown as ParsedType)
        }

        // Otherwise, convert by type name
        if (propInfo.typeName) {
            return this.convert(propInfo.typeName)
        }

        // Fallback
        return this.visitUnknown({kind: 'primitive', baseType: 'any'})
    }

    /**
     * Parse inline object type string to property map
     * Example: "{ name: string, age: number }" -> { name: 'string', age: 'number' }
     *
     * This is shared logic that both JSON Schema and Validator need
     */
    protected static parseInlineObjectType(typeStr: string): Record<string, string> {
        const result: Record<string, string> = {}

        // Remove outer braces and normalize whitespace
        let content = typeStr.trim()
        if (content.startsWith('{')) {
            content = content.substring(1)
        }
        if (content.endsWith('}')) {
            content = content.substring(0, content.length - 1)
        }
        content = content.trim()

        if (!content) {
            return result
        }

        // Split by comma or semicolon, but handle nested braces
        const properties: string[] = []
        let currentProp = ''
        let depth = 0

        for (let i = 0; i < content.length; i++) {
            const char = content[i]

            if (char === '{' || char === '<' || char === '[') {
                depth++
                currentProp += char
            } else if (char === '}' || char === '>' || char === ']') {
                depth--
                currentProp += char
            } else if ((char === ',' || char === ';') && depth === 0) {
                if (currentProp.trim()) {
                    properties.push(currentProp.trim())
                }
                currentProp = ''
            } else {
                currentProp += char
            }
        }

        // Add last property
        if (currentProp.trim()) {
            properties.push(currentProp.trim())
        }

        // Parse each property
        for (const prop of properties) {
            // Handle optional properties (name?: type)
            const optionalMatch = prop.match(/^(\w+)\??\s*:\s*(.+)$/)
            if (optionalMatch) {
                const propName = optionalMatch[1]
                const propType = optionalMatch[2].trim()
                result[propName] = propType
            }
        }

        return result
    }
}
