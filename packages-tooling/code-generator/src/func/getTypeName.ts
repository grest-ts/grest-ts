/**
 * Helper utilities for working with ParsedType
 * Makes handling branded types and other special cases easier
 */

import {ParsedType} from '../core/ParsedType'

/**
 * Get the type name to use in generated code
 * For branded types, use the brand name
 * For primitives, use the base type
 *
 * @example
 * ```ts
 * // Branded type
 * type UserId = string & { __brand: 'UserId' }
 * getTypeName({ kind: 'branded', name: 'UserId', baseType: 'string' })
 * // returns 'UserId'
 *
 * // Primitive
 * getTypeName({ kind: 'primitive', baseType: 'string' })
 * // returns 'string'
 * ```
 */
export function getTypeName(type: ParsedType): string {
    // First try name (preserves type name even for unresolved external types)
    if (type.name) {
        return type.name
    }
    // Then try baseType (for primitives and branded types)
    if (type.baseType) {
        // Special case: if baseType is 'any' but we have no name, this might be a resolution error
        // However, we should still return 'any' for legitimate any types
        return type.baseType
    }
    // Handle arrays
    if (type.kind === 'array' && type.elementType) {
        return `${getTypeName(type.elementType)}[]`
    }

    // Don't silently fail - throw error to help debug type resolution issues
    throw new Error(
        `Unable to extract type name from ParsedType. ` +
        `Kind: ${type.kind}, Name: ${type.name}, BaseType: ${type.baseType}, ` +
        `Type: ${JSON.stringify(type, null, 2)}`
    )
}
