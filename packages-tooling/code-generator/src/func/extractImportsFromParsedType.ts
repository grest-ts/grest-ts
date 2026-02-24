/**
 * TypeImportExtractor - Utility to extract import information from ParsedType structures
 *
 * Traverses ParsedType trees to find all type references that need to be imported
 */

import {ParsedType} from '../core/ParsedType'

export interface TypeImport {
    name: string
    sourcePath: string
}

/**
 * Extract all type imports from a ParsedType by traversing its structure
 * @param type The parsed type to extract imports from
 * @param traverseExternalTypeProperties If true, traverse into properties even for types with sourcePath.
 *                                       Use true when copying type definitions, false when just referencing them.
 */
export function extractImportsFromParsedType(type: ParsedType | undefined, traverseExternalTypeProperties: boolean = false): TypeImport[] {
    if (!type) return []

    const imports: TypeImport[] = []
    const seen = new Set<string>()

    function traverse(t: ParsedType, depth: number = 0) {
        // Add this type to imports if it has a name and source path
        // PropertyInfo uses 'typeName' while ParsedType uses 'name', check both
        const typeName = t.name || (t as any).typeName
        if (typeName && t.sourcePath) {
            const key = `${typeName}:${t.sourcePath}`
            if (!seen.has(key)) {
                seen.add(key)
                imports.push({
                    name: typeName,
                    sourcePath: t.sourcePath
                })
            }
        }

        // Traverse based on type kind
        switch (t.kind) {
            case 'interface':
            case 'type':
                // Only traverse into properties if:
                // 1. This is an inline type (no sourcePath), OR
                // 2. This is the root type (depth === 0) AND traverseExternalTypeProperties is true
                //
                // We stop at external types (sourcePath != null) when depth > 0, even if
                // traverseExternalTypeProperties is true, because we don't want to import
                // nested types from external files when copying a type that references them.
                const shouldTraverse = !t.sourcePath || (depth === 0 && traverseExternalTypeProperties)

                if (shouldTraverse) {
                    // Traverse properties
                    if (t.properties) {
                        for (const prop of Object.values(t.properties)) {
                            if (prop.kind) {
                                // PropertyInfo can be treated as a ParsedType
                                traverse(prop as any as ParsedType, depth + 1)
                            }
                        }
                    }
                }
                // Traverse type arguments (for generics)
                if (t.typeArguments) {
                    for (const typeArg of t.typeArguments) {
                        traverse(typeArg, depth + 1)
                    }
                }
                break

            case 'array':
                // Traverse element type
                if (t.elementType) {
                    traverse(t.elementType, depth + 1)
                }
                break

            case 'union':
                // Traverse all union members
                if (t.unionTypes) {
                    for (const unionType of t.unionTypes) {
                        traverse(unionType, depth + 1)
                    }
                }
                break

            case 'branded':
                // Branded types themselves need to be imported (e.g., tUserId)
                // No further traversal needed
                break

            case 'enum':
                // Enums need to be imported as values
                // No further traversal needed
                break

            case 'class':
                // Classes need to be imported (typically used for auth states)
                // No further traversal needed
                break

            case 'literal':
                // Literals with enum member references need the enum imported
                if (t.enumMemberReference && t.sourcePath) {
                    // Extract enum name from reference like "MyEnum.value"
                    const enumName = t.enumMemberReference.split('.')[0]
                    const key = `${enumName}:${t.sourcePath}`
                    if (!seen.has(key)) {
                        seen.add(key)
                        imports.push({
                            name: enumName,
                            sourcePath: t.sourcePath
                        })
                    }
                }
                break

            case 'primitive':
                // Primitives don't need imports
                break
        }
    }

    traverse(type)
    return imports
}
