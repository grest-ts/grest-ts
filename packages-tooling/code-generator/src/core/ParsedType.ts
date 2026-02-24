/**
 * Parsed type information - Core infrastructure for type analysis
 *
 * These types represent the parsed structure of TypeScript types,
 * used by validators, contracts, and code generators.
 */

export interface ParsedType {
    /** Fundamental kind of type */
    kind: 'primitive' | 'branded' | 'interface' | 'type' | 'enum' | 'union' | 'array' | 'literal' | 'class'

    /** Optional type name */
    name?: string

    /**
     * For primitive and branded types - the underlying primitive type
     *
     * Examples:
     * - Primitive: kind='primitive', baseType='string'
     * - Branded: kind='branded', name='UserId', baseType='string'
     *
     * For validators: Always validate branded types as their baseType at runtime
     * For SDK copying: Preserve the brand definition from `definition` field
     */
    baseType?: 'string' | 'number' | 'boolean' | 'any' | 'void' | 'unknown' | 'undefined'

    /** For interface/type kinds - object properties */
    properties?: Record<string, PropertyInfo>

    /** For enum kind - enumeration values */
    enumValues?: (string | number)[]

    /** For union kind - union member types */
    unionTypes?: ParsedType[]

    /** For array kind - element type */
    elementType?: ParsedType

    /** For literal kind - the literal value */
    literalValue?: string | number | boolean | null

    /** For enum member references like ComplexResultType.type1 */
    enumMemberReference?: string

    /** Types this interface extends */
    extendsTypes?: string[]

    /** Path to the source file where this type is defined */
    sourcePath?: string

    /** JSDoc comment from type definition */
    description?: string

    // Generic type support (flags, not a kind)
    /** Generic type parameters (e.g., ['T', 'U'] for interface Foo<T, U>) */
    typeParameters?: string[]

    /** Actual type arguments for generic instantiations (e.g., [string, number] for Foo<string, number>) */
    typeArguments?: ParsedType[]

    /** For generic instantiations, the base generic type name (e.g., 'GenericInterface' for GenericInterface<string>) */
    genericBase?: string

    // Recursive type flag
    /** True if this type references itself (recursive type) */
    isRecursive?: boolean

    // Branded type validator information
    /** For branded types - the validator class name (e.g., "IsEmail", "IsStringRange") */
    validatorClassName?: string

    /** For branded types - the validator class source path (e.g., "@grest-ts/validator") */
    validatorSourcePath?: string

    /** For branded types with parameterized validators - constructor arguments (e.g., [3, 10] for IsStringRange) */
    validatorArguments?: (string | number)[]
}

export interface PropertyInfo {
    name: string
    typeName?: string
    optional: boolean
    kind?: ParsedType['kind']
    baseType?: ParsedType['baseType']
    properties?: Record<string, PropertyInfo>
    elementType?: ParsedType
    unionTypes?: ParsedType[]
    sourcePath?: string
    description?: string
    example?: any

    // Branded type validator information (inherited from ParsedType)
    validatorClassName?: string
    validatorSourcePath?: string
    validatorArguments?: (string | number)[]
}
