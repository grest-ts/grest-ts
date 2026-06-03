import * as ts from 'typescript'
import * as path from 'path'
import * as fs from 'fs'
import {ParsedType, PropertyInfo} from './ParsedType'
import {verbose} from '../utils/Logger'
import {CodeGeneratorError} from './CodeGeneratorError'

const ANONYMOUS_TYPE_SYMBOL = '__type'

/**
 * TypeExtractor - Uses TypeScript Compiler API to extract and resolve types
 *
 * Creates ONE TypeScript Program per API file, which includes all imports.
 * Uses TypeChecker for accurate type resolution (handles branded types, unions, etc.)
 */
export class TypeExtractor {
    private program: ts.Program
    private checker: ts.TypeChecker
    private sourceFile: ts.SourceFile
    private resolvingTypes = new Set<string>() // Track types currently being resolved to prevent infinite recursion
    private typeCache = new Map<string, ParsedType | null>() // Cache resolved types (null = not found) - Key format: "absolutePath:typeName"
    private brandedTypeValidatorCache = new Map<string, { className: string; sourcePath: string; arguments: (string | number)[]; typeArguments: ts.Type[] } | null>() // Cache branded type validator info - Key format: "absolutePath:typeString"

    // Performance metrics
    public resolveTypeCallCount = 0

    /**
     * Generate cache key scoped by source file path and type name
     * This prevents cache collisions when the same type name exists in different files
     */
    private getCacheKey(typeName: string, sourceFilePath: string): string {
        return `${sourceFilePath}:${typeName}`
    }

    /**
     * Find tsconfig.json by searching upwards from the given directory
     * @param startDir - The directory to start searching from
     * @returns The path to tsconfig.json, or null if not found
     */
    private findTsConfig(startDir: string): string | null {
        let currentDir = path.resolve(startDir)
        const root = path.parse(currentDir).root

        while (currentDir !== root) {
            const tsconfigPath = path.join(currentDir, 'tsconfig.json')
            verbose(`[TypeExtractor] Searching for tsconfig at: ${tsconfigPath}`)

            if (fs.existsSync(tsconfigPath)) {
                return tsconfigPath
            }

            // Move up one directory
            const parentDir = path.dirname(currentDir)
            if (parentDir === currentDir) {
                // Reached the root
                break
            }
            currentDir = parentDir
        }

        return null
    }

    /**
     * Constructor accepts either a single file path or multiple file paths
     * When multiple paths are provided, they all share the same TypeScript program (more efficient for tests)
     *
     * @param apiFilePathOrPaths - Single file path or array of file paths
     * @param options - Optional generator options (for skipLibCheck, etc.)
     */
    constructor(apiFilePathOrPaths: string | string[], private options?: { skipLibCheck?: boolean }) {
        const apiFilePaths = Array.isArray(apiFilePathOrPaths) ? apiFilePathOrPaths : [apiFilePathOrPaths]
        const mainFilePath = apiFilePaths[0]

        // Find tsconfig.json by searching upwards from the API file directory
        const tsconfigPath = this.findTsConfig(path.dirname(mainFilePath))

        verbose(`[TypeExtractor] Found tsconfig at: ${tsconfigPath}`)

        if (!tsconfigPath) {
            throw CodeGeneratorError.configError(
                `TypeExtractor requires a tsconfig.json to resolve imports properly.\n\n` +
                `  Searched from: ${path.dirname(mainFilePath)}\n` +
                `  Please ensure a tsconfig.json exists in your project root or API file directory.`,
                mainFilePath
            )
        }

        // Load and parse tsconfig.json
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
        if (configFile.error) {
            throw CodeGeneratorError.configError(
                `Error reading tsconfig.json:\n  ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`,
                tsconfigPath
            )
        }

        verbose(`[TypeExtractor] Parsing tsconfig from: ${path.dirname(tsconfigPath)}`)
        const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            path.dirname(tsconfigPath)
        )

        if (parsedConfig.errors && parsedConfig.errors.length > 0) {
            verbose(`[TypeExtractor] tsconfig parse errors:`, parsedConfig.errors.map(e => e.messageText))
        }

        verbose(`[TypeExtractor] Compiler options baseUrl:`, parsedConfig.options.baseUrl)
        verbose(`[TypeExtractor] Compiler options paths:`, parsedConfig.options.paths)

        // Determine if we should skip lib checking based on config (default: false for safety)
        const shouldSkipLibCheck = this.options?.skipLibCheck ?? false

        // Optimize compiler options if requested
        // Note: skipLibCheck can improve performance but may hide type errors in external libraries
        const compilerOptions: ts.CompilerOptions = {
            ...parsedConfig.options,
            ...(shouldSkipLibCheck ? {
                skipLibCheck: true,           // Skip type checking of .d.ts files
                skipDefaultLibCheck: true,     // Skip checking default library files
            } : {}),
            noResolve: false,              // Keep this false - we need to resolve imports for type extraction
            // Preserve the original paths and baseUrl for proper import resolution
            paths: parsedConfig.options.paths,
            baseUrl: parsedConfig.options.baseUrl,
        }

        if (shouldSkipLibCheck) {
            verbose(`[TypeExtractor] Creating program with skipLibCheck enabled (faster but may hide library type errors)`)
        } else {
            verbose(`[TypeExtractor] Creating program with full type checking (safer, recommended if using external library types)`)
        }

        // Create program with all provided files (shares the TypeScript program for efficiency)
        this.program = ts.createProgram(apiFilePaths, compilerOptions)
        this.checker = this.program.getTypeChecker()
        this.sourceFile = this.program.getSourceFile(mainFilePath)!

        if (!this.sourceFile) {
            throw CodeGeneratorError.fileNotFoundError(
                mainFilePath,
                'Failed to load source file in TypeScript program'
            )
        }

        // Log all source files in the program for debugging
        const programFiles = this.program.getSourceFiles()
            .filter(sf => !sf.fileName.includes('node_modules') && !sf.fileName.includes('/lib.'))
            .map(sf => sf.fileName)
        verbose(`[TypeExtractor] Program contains ${programFiles.length} source files:`, programFiles.slice(0, 10))
    }

    /**
     * Set the active source file for extraction
     * Useful when the TypeExtractor was created with multiple files
     *
     * @param apiFilePath - Path to the file to make active
     */
    setSourceFile(apiFilePath: string): void {
        const sourceFile = this.program.getSourceFile(apiFilePath)
        if (!sourceFile) {
            throw CodeGeneratorError.fileNotFoundError(
                apiFilePath,
                'Source file not found in TypeScript program'
            )
        }
        this.sourceFile = sourceFile
        // Clear resolution state when switching files
        this.resolvingTypes.clear()
    }

    /**
     * Get all types from a specific source file
     * Used for opportunistic caching - when we parse a file for one type,
     * we cache ALL types from that file to avoid re-parsing
     *
     * @param sourceFilePath - Absolute path to the source file
     * @returns Array of all exported types from that file
     */
    getAllTypesFromFile(sourceFilePath: string): ParsedType[] {
        // Find the source file in the program
        const sourceFile = this.program.getSourceFile(sourceFilePath)
        if (!sourceFile) {
            verbose(`[getAllTypesFromFile] Source file not found: ${sourceFilePath}`)
            return []
        }

        const types: ParsedType[] = []

        // Visit all exported type declarations
        const visit = (node: ts.Node) => {
            // Check if node is exported
            const isExported =
                ts.canHaveModifiers(node) &&
                ts.getModifiers(node)?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword)

            if (!isExported) {
                // Still need to recurse for nested declarations
                ts.forEachChild(node, visit)
                return
            }

            // Get type name
            let typeName: string | undefined

            if (ts.isInterfaceDeclaration(node) && node.name) {
                typeName = node.name.text
            } else if (ts.isTypeAliasDeclaration(node) && node.name) {
                typeName = node.name.text
            } else if (ts.isEnumDeclaration(node) && node.name) {
                typeName = node.name.text
            } else if (ts.isClassDeclaration(node) && node.name) {
                typeName = node.name.text
            }

            // If we found a type, resolve it (this will use the cache if already resolved)
            if (typeName) {
                const parsed = this.resolveType(typeName)
                if (parsed) {
                    types.push(parsed)
                }
            }

            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
        return types
    }

    /**
     * Resolve a type by name to get its parsed structure (with caching)
     */
    resolveType(typeName: string): ParsedType {
        this.resolveTypeCallCount++
        verbose(`[resolveType] ========== START resolving: ${typeName} ==========`)

        // Handle primitive types
        if (this.isPrimitiveType(typeName)) {
            verbose(`[resolveType] ${typeName} is primitive`)
            return {
                kind: 'primitive',
                baseType: typeName as 'string' | 'number' | 'boolean' | 'void' | 'any' | 'unknown' | 'undefined'
            }
        }

        // Prevent infinite recursion for circular type references
        if (this.resolvingTypes.has(typeName)) {
            verbose(`[resolveType] ${typeName} is already being resolved (recursion guard)`)
            verbose(`[resolveType] Currently resolving:`, Array.from(this.resolvingTypes))
            return {
                kind: 'interface',
                name: typeName,
                properties: {}
            }
        }

        // Mark as currently resolving
        verbose(`[resolveType] Adding ${typeName} to resolvingTypes set`)
        this.resolvingTypes.add(typeName)

        try {
            // Find the type declaration in ANY source file (including imports)
            // IMPORTANT: Search the active source file FIRST to avoid name conflicts
            let typeDeclaration: ts.Node | undefined
            let foundSourceFile: ts.SourceFile | undefined

            const visit = (node: ts.Node, sourceFile: ts.SourceFile) => {
                if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
                    typeDeclaration = node
                    foundSourceFile = sourceFile
                }
                if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
                    typeDeclaration = node
                    foundSourceFile = sourceFile
                }
                if (ts.isEnumDeclaration(node) && node.name.text === typeName) {
                    typeDeclaration = node
                    foundSourceFile = sourceFile
                }
                if (ts.isClassDeclaration(node) && node.name && node.name.text === typeName) {
                    typeDeclaration = node
                    foundSourceFile = sourceFile
                }
                if (!typeDeclaration) {
                    ts.forEachChild(node, (n) => visit(n, sourceFile))
                }
            }

            // Search the ACTIVE source file first (prioritize local types)
            verbose(`[resolveType] Searching active source file first: ${this.sourceFile.fileName}`)
            visit(this.sourceFile, this.sourceFile)

            if (typeDeclaration) {
                verbose(`[resolveType] Found ${typeName} in active file`)
            }

            // If not found in active file, search other source files
            if (!typeDeclaration) {
                verbose(`[resolveType] Type not found in active file, searching other files...`)
                for (const sourceFile of this.program.getSourceFiles()) {
                    // Skip the active file (already searched), node_modules, and lib files
                    if (sourceFile === this.sourceFile ||
                        sourceFile.fileName.includes('node_modules') ||
                        sourceFile.fileName.includes('/lib.')) {
                        continue
                    }
                    visit(sourceFile, sourceFile)
                    if (typeDeclaration) {
                        verbose(`[resolveType] Found ${typeName} in:`, sourceFile.fileName)
                        break
                    }
                }
            }

            if (!typeDeclaration || !foundSourceFile) {
                // Type not found - throw error to catch wrong references early
                verbose(`[resolveType] ${typeName} NOT FOUND - throwing error`)
                throw new Error(
                    `Type '${typeName}' not found. ` +
                    `This could be:\n` +
                    `  1. A typo or wrong reference in the code\n` +
                    `  2. An external type from node_modules (not supported)\n` +
                    `  3. A type that needs to be imported\n` +
                    `\nSearched in ${this.program.getSourceFiles().filter(f => !f.fileName.includes('node_modules') && !f.fileName.includes('/lib.')).length} source files.`
                )
            }

            verbose(`[resolveType] Found ${typeName} declaration in ${foundSourceFile.fileName}`)

            // Check cache with source-file-scoped key
            const cacheKey = this.getCacheKey(typeName, foundSourceFile.fileName)
            verbose(`[resolveType] Cache key:`, cacheKey)
            if (this.typeCache.has(cacheKey)) {
                const cached = this.typeCache.get(cacheKey)
                verbose(`[resolveType] ${typeName} found in cache for ${foundSourceFile.fileName}:`, cached ? {kind: cached.kind} : 'NULL')
                // If cached as "not found" (null), return primitive 'any'
                if (cached == null) {
                    return {kind: 'primitive', baseType: 'any'}
                }
                return cached
            }

            // Use TypeChecker to resolve the type
            const parsedType = this.parseTypeNode(typeDeclaration, foundSourceFile)

            verbose(`[resolveType] Parsed ${typeName}:`, {
                kind: parsedType.kind,
                name: parsedType.name,
                hasProperties: !!parsedType.properties,
                hasUnionTypes: !!parsedType.unionTypes,
                hasExtendsTypes: !!parsedType.extendsTypes
            })

            // Add source path to the parsed type (keep as absolute path, will be resolved in FileImports)
            parsedType.sourcePath = foundSourceFile.fileName

            // Cache the resolved type with source-file-scoped key
            verbose(`[resolveType] Caching resolved type for ${typeName} in ${foundSourceFile.fileName}`)
            this.typeCache.set(cacheKey, parsedType)

            verbose(`[resolveType] ========== END resolving: ${typeName} ==========`)
            return parsedType
        } finally {
            // Remove from resolving set
            this.resolvingTypes.delete(typeName)
        }
    }

    /**
     * Parse a type node using TypeChecker
     */
    public parseTypeNode(node: ts.Node, sourceFile: ts.SourceFile): ParsedType {
        if (ts.isInterfaceDeclaration(node)) {
            return this.parseInterface(node, sourceFile)
        }

        if (ts.isTypeAliasDeclaration(node)) {
            return this.parseTypeAlias(node, sourceFile)
        }

        if (ts.isEnumDeclaration(node)) {
            return this.parseEnum(node, sourceFile)
        }

        if (ts.isClassDeclaration(node) && node.name) {
            // For classes, return a basic type representation
            // Classes are typically used for auth states and other runtime values
            return {
                kind: 'class',
                name: node.name.text,
                properties: {},
                description: this.extractJSDocComment(node)
            }
        }

        return {kind: 'primitive', baseType: 'any'}
    }

    /**
     * Parse an interface declaration
     */
    private parseInterface(node: ts.InterfaceDeclaration, sourceFile: ts.SourceFile): ParsedType {
        const properties: Record<string, PropertyInfo> = {}
        const extendsTypes: string[] = []
        const typeParameters: string[] = []

        verbose(`[parseInterface] Parsing interface ${node.name.text}`)
        verbose(`[parseInterface] Source file:`, sourceFile.fileName)
        verbose(`[parseInterface] Members count:`, node.members.length)

        // Extract type parameters (e.g., <T, U> from interface Foo<T, U>)
        if (node.typeParameters) {
            for (const typeParam of node.typeParameters) {
                typeParameters.push(typeParam.name.text)
            }
        }

        // Get heritage clauses (extends)
        if (node.heritageClauses) {
            for (const clause of node.heritageClauses) {
                for (const type of clause.types) {
                    // Get the full type text including generic parameters
                    // This preserves information like "ValidatedBy<CreateItemRequestValidator>"
                    // which is needed for extracting validator class names
                    const fullTypeText = type.getText(sourceFile)
                    extendsTypes.push(fullTypeText)
                }
            }
        }

        // Parse properties
        for (const member of node.members) {
            if (ts.isPropertySignature(member) && member.name) {
                const propName = member.name.getText(sourceFile)
                const propType = member.type ? this.parseTypeReference(member.type, sourceFile, typeParameters) : {kind: 'primitive' as const, baseType: 'any' as const}
                const optional = !!member.questionToken
                const description = this.extractJSDocComment(member)
                const example = this.extractJSDocExample(member)

                properties[propName] = {
                    name: propName,
                    optional,
                    typeName: member.type?.getText(sourceFile),
                    description,
                    example,
                    ...propType
                }
            }
        }

        verbose(`[parseInterface] Parsed ${node.name.text} properties:`, Object.keys(properties).length)
        verbose(`[parseInterface] Property names:`, Object.keys(properties))

        return {
            kind: 'interface',
            name: node.name.text,
            properties,
            extendsTypes: extendsTypes.length > 0 ? extendsTypes : undefined,
            typeParameters: typeParameters.length > 0 ? typeParameters : undefined,
            description: this.extractJSDocComment(node)
        }
    }

    /**
     * Parse a type alias
     */
    private parseTypeAlias(node: ts.TypeAliasDeclaration, sourceFile: ts.SourceFile): ParsedType {
        // Extract type parameters (e.g., <Type, Validator> from type tCustom<Type, Validator>)
        const typeParameters: string[] = []
        if (node.typeParameters) {
            for (const typeParam of node.typeParameters) {
                typeParameters.push(typeParam.name.text)
            }
        }

        // Check the SYNTAX first for intersection types (branded types)
        // TypeScript's type checker simplifies "any & { brand: never }" to just "any"
        // So we need to look at the actual syntax node
        if (ts.isIntersectionTypeNode(node.type)) {
            // This is syntactically an intersection - check if it's a branded type
            const types = node.type.types
            if (types.length >= 2) {
                // Get the first type (should be the base type)
                const firstType = types[0]
                let baseType: 'string' | 'number' | 'boolean' | 'any' | 'void' | 'undefined' | 'unknown' | undefined

                // Direct primitive keywords
                if (firstType.kind === ts.SyntaxKind.StringKeyword) {
                    baseType = 'string'
                } else if (firstType.kind === ts.SyntaxKind.NumberKeyword) {
                    baseType = 'number'
                } else if (firstType.kind === ts.SyntaxKind.BooleanKeyword) {
                    baseType = 'boolean'
                } else if (firstType.kind === ts.SyntaxKind.AnyKeyword) {
                    baseType = 'any'
                } else if (firstType.kind === ts.SyntaxKind.VoidKeyword) {
                    baseType = 'void'
                } else if (ts.isTypeReferenceNode(firstType)) {
                    // The first type is a reference (e.g., tSimpleHashAuthToken or a type parameter)
                    const firstTypeName = firstType.typeName.getText(sourceFile)

                    // Check if it's a type parameter - if so, treat as 'any'
                    if (typeParameters.includes(firstTypeName)) {
                        baseType = 'any'
                    } else {
                        // Try to resolve it to see if it's ultimately a branded primitive
                        const resolvedFirstType = this.resolveType(firstTypeName)
                        if (resolvedFirstType.kind === 'branded' && resolvedFirstType.baseType) {
                            // It's a branded type wrapping another branded type
                            // Use the ultimate base type (filter out 'unknown')
                            const resolvedBase = resolvedFirstType.baseType
                            if (resolvedBase !== 'unknown') {
                                baseType = resolvedBase
                            }
                        }
                    }
                }

                if (baseType) {
                    // Extract validator information
                    const type = this.checker.getTypeAtLocation(node)
                    const validatorInfo = this.extractBrandedTypeValidator(type, node, sourceFile)

                    const result: ParsedType = {
                        kind: 'branded',
                        name: node.name.text,
                        baseType
                    }

                    // Add validator information if found
                    if (validatorInfo) {
                        result.validatorClassName = validatorInfo.className
                        result.validatorSourcePath = validatorInfo.sourcePath
                        result.validatorArguments = validatorInfo.arguments
                    }

                    return result
                }
            }
        }

        const type = this.checker.getTypeAtLocation(node)

        // Check for union types
        if (type.isUnion()) {
            return this.parseUnionType(node.name.text, type)
        }

        // Parse the type node
        return this.parseTypeReference(node.type, sourceFile, typeParameters)
    }

    /**
     * Parse a union type
     */
    private parseUnionType(name: string, type: ts.Type): ParsedType {
        verbose(`[parseUnionType] ===== Parsing union: ${name} =====`)
        const unionTypes = (type as ts.UnionType).types.map((t, index) => {
            verbose(`[parseUnionType:${name}] Processing member ${index}`)

            // Check if this is an anonymous object type (has properties but no name)
            if (t.isClassOrInterface() || (t.flags & ts.TypeFlags.Object)) {
                const properties = t.getProperties()
                if (properties.length > 0) {
                    // This might be an inline object type - check if it has a symbol with a name
                    const symbol = t.getSymbol()
                    const symbolName = symbol?.getName()

                    // If no symbol or symbol name is ANONYMOUS_TYPE_SYMBOL, it's an anonymous inline object
                    if (!symbol || symbolName === ANONYMOUS_TYPE_SYMBOL) {
                        verbose(`[parseUnionType:${name}] Member ${index} is anonymous object with ${properties.length} properties`)
                        // Parse inline object type directly
                        const parsedProps: Record<string, any> = {}
                        for (const prop of properties) {
                            const propName = prop.getName()
                            const propType = this.checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!)
                            const propTypeString = this.checker.typeToString(propType)

                            // Try to parse the property type more precisely
                            const propDeclaration = prop.valueDeclaration
                            let parsedPropType: any
                            if (propDeclaration && ts.isPropertySignature(propDeclaration) && propDeclaration.type) {
                                parsedPropType = this.parseTypeReference(propDeclaration.type, propDeclaration.getSourceFile())
                            } else {
                                // Fallback: try to resolve by type string
                                parsedPropType = this.resolveType(propTypeString)
                            }

                            parsedProps[propName] = {
                                name: propName,
                                optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
                                typeName: propTypeString,
                                ...parsedPropType
                            }
                        }

                        return {
                            kind: 'interface' as const,
                            properties: parsedProps
                            // No name since this is an inline type
                        }
                    }
                }
            }

            // Get the type name using TypeChecker (works for synthetic nodes too!)
            const typeName = this.checker.typeToString(t)
            verbose(`[parseUnionType:${name}] Member ${index} type name: "${typeName}"`)

            // Now resolve this type by name to get full type information
            const resolvedType = this.resolveType(typeName)
            verbose(`[parseUnionType:${name}] Member ${index} resolved:`, {
                kind: resolvedType.kind,
                name: resolvedType.name,
                hasProperties: !!resolvedType.properties
            })

            // Return the full resolved type so discriminator detection can access properties
            return resolvedType
        })

        return {
            kind: 'union',
            name,
            unionTypes
        }
    }

    /**
     * Parse a type reference (from property types, etc.)
     */
    public parseTypeReference(typeNode: ts.TypeNode, sourceFile: ts.SourceFile, typeParameters?: string[]): ParsedType {
        verbose(`[parseTypeReference] Called with node kind: ${ts.SyntaxKind[typeNode.kind]}`)

        // Primitive types
        if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
            return {kind: 'primitive', baseType: 'string'}
        }
        if (typeNode.kind === ts.SyntaxKind.NumberKeyword) {
            return {kind: 'primitive', baseType: 'number'}
        }
        if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
            return {kind: 'primitive', baseType: 'boolean'}
        }
        if (typeNode.kind === ts.SyntaxKind.VoidKeyword) {
            return {kind: 'primitive', baseType: 'void'}
        }
        if (typeNode.kind === ts.SyntaxKind.UndefinedKeyword) {
            return {kind: 'primitive', baseType: 'undefined'}
        }
        if (typeNode.kind === ts.SyntaxKind.AnyKeyword) {
            return {kind: 'primitive', baseType: 'any'}
        }
        if (typeNode.kind === ts.SyntaxKind.UnknownKeyword) {
            return {kind: 'primitive', baseType: 'unknown'}
        }

        // Array types
        if (ts.isArrayTypeNode(typeNode)) {
            return {
                kind: 'array',
                elementType: this.parseTypeReference(typeNode.elementType, sourceFile, typeParameters)
            }
        }

        // Type reference (named type)
        if (ts.isTypeReferenceNode(typeNode)) {
            const typeName = typeNode.typeName.getText(sourceFile)
            verbose(`[parseTypeReference] Found TypeReference: ${typeName}`)

            // Check if this is a generic type parameter (e.g., T, U, K, V)
            if (typeParameters && typeParameters.includes(typeName)) {
                verbose(`[parseTypeReference] ${typeName} is a generic type parameter - treating as 'any'`)
                // Return 'any' for generic type parameters since we can't validate them at runtime
                // Validators will use IsAny for these properties
                return {kind: 'primitive', baseType: 'any', name: typeName}
            }

            // Check if this is an enum member access (e.g., ComplexResultType.type1)
            if (typeName.includes('.')) {
                verbose(`[parseTypeReference] TypeReference contains dot - treating as literal enum member: ${typeName}`)
                // This is an enum member access - treat it as a literal
                // Extract the value (e.g., "type1" from "ComplexResultType.type1")
                const parts = typeName.split('.')
                const memberName = parts[parts.length - 1]
                return {
                    kind: 'literal',
                    literalValue: memberName,
                    enumMemberReference: typeName  // Store the full reference
                }
            }

            // Check if this type has type arguments (e.g., GenericInterface<string>, tStringRange<3, 10>)
            if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
                verbose(`[parseTypeReference] ${typeName} has ${typeNode.typeArguments.length} type arguments`)
                const typeArguments = typeNode.typeArguments.map(arg => this.parseTypeReference(arg, sourceFile, typeParameters))

                // Resolve the base type to get its sourcePath, kind, and baseType
                const resolvedType = this.resolveType(typeName)
                verbose(`[parseTypeReference] Resolved generic type ${typeName}:`, {
                    kind: resolvedType.kind,
                    baseType: resolvedType.baseType,
                    hasSourcePath: !!resolvedType.sourcePath
                })

                // For branded types with generics (e.g., tStringRange<3, 10>), preserve the branded kind
                // The kind should be 'branded' if the base type is branded
                const result: ParsedType = {
                    kind: resolvedType.kind, // 'branded' for tStringRange, 'type' for generic interfaces
                    name: typeName,
                    baseType: resolvedType.baseType, // 'string' for tStringRange
                    genericBase: typeName,
                    typeArguments,
                    sourcePath: resolvedType.sourcePath
                }

                // For generic branded types, extract validator info from the instantiated type
                if (resolvedType.kind === 'branded') {
                    // Get the type alias declaration for the generic branded type
                    const type = this.checker.getTypeAtLocation(typeNode)
                    const symbol = type.getSymbol() || type.aliasSymbol

                    if (symbol) {
                        const declarations = symbol.getDeclarations()
                        if (declarations && declarations.length > 0) {
                            const declaration = declarations[0]
                            if (ts.isTypeAliasDeclaration(declaration)) {
                                // Extract concrete type argument types from the parsed typeArguments
                                // Convert ParsedType back to ts.Type for extraction
                                const concreteTypeArgs = typeNode.typeArguments?.map(ta => this.checker.getTypeAtLocation(ta))

                                // Extract validator with the specific type arguments
                                const validatorInfo = this.extractBrandedTypeValidator(type, declaration, sourceFile, concreteTypeArgs)
                                if (validatorInfo) {
                                    result.validatorClassName = validatorInfo.className
                                    result.validatorSourcePath = validatorInfo.sourcePath
                                    result.validatorArguments = validatorInfo.arguments
                                }
                            }
                        }
                    }
                }

                return result
            }

            // Recursively resolve the actual type to handle branded types correctly
            const resolvedType = this.resolveType(typeName)
            verbose(`[parseTypeReference] Resolved ${typeName}:`, {
                kind: resolvedType.kind,
                name: resolvedType.name,
                hasSourcePath: !!resolvedType.sourcePath
            })

            // If it's a branded type, return that instead of treating it as an interface
            if (resolvedType.kind === 'branded') {
                return resolvedType
            }

            // For enums, return the enum type directly
            if (resolvedType.kind === 'enum') {
                return resolvedType
            }

            // Otherwise return the full resolved type
            // We need all fields (properties, unionTypes, etc.) for validator generation
            verbose(`[parseTypeReference] Returning full resolved type for ${typeName}`)
            return resolvedType
        }

        // Literal types
        if (ts.isLiteralTypeNode(typeNode)) {
            const literal = typeNode.literal
            // Handle string literals
            if (ts.isStringLiteral(literal)) {
                verbose(`[parseTypeReference] Found string literal: ${literal.text}`)
                return {
                    kind: 'literal',
                    literalValue: literal.text
                }
            }
            // Handle numeric literals
            if (ts.isNumericLiteral(literal)) {
                const numValue = Number(literal.text)
                verbose(`[parseTypeReference] Found numeric literal: ${numValue}`)
                return {
                    kind: 'literal',
                    literalValue: numValue
                }
            }
            // Handle null literal (NullKeyword inside LiteralTypeNode)
            if (literal.kind === ts.SyntaxKind.NullKeyword) {
                verbose(`[parseTypeReference] Found null literal`)
                return {
                    kind: 'literal',
                    literalValue: null
                }
            }
            // Handle true/false literals
            if (literal.kind === ts.SyntaxKind.TrueKeyword) {
                return {kind: 'literal', literalValue: true}
            }
            if (literal.kind === ts.SyntaxKind.FalseKeyword) {
                return {kind: 'literal', literalValue: false}
            }
        }

        // Parenthesized types - unwrap and parse the inner type
        if (typeNode.kind === ts.SyntaxKind.ParenthesizedType) {
            const parenthesized = typeNode as ts.ParenthesizedTypeNode
            return this.parseTypeReference(parenthesized.type, sourceFile, typeParameters)
        }

        // Union types
        if (ts.isUnionTypeNode(typeNode)) {
            return {
                kind: 'union',
                unionTypes: typeNode.types.map(t => this.parseTypeReference(t, sourceFile, typeParameters))
            }
        }

        // Inline object types (type literals)
        if (ts.isTypeLiteralNode(typeNode)) {
            const properties: Record<string, PropertyInfo> = {}

            // Parse properties
            for (const member of typeNode.members) {
                if (ts.isPropertySignature(member) && member.name) {
                    const propName = member.name.getText(sourceFile)
                    const propType = member.type ? this.parseTypeReference(member.type, sourceFile, typeParameters) : {kind: 'primitive' as const, baseType: 'any' as const}
                    const optional = !!member.questionToken

                    properties[propName] = {
                        name: propName,
                        optional,
                        typeName: member.type?.getText(sourceFile),
                        ...propType
                    }
                }
            }

            return {
                kind: 'interface',
                properties,
                // No name since this is an inline type
            }
        }

        return {kind: 'primitive', baseType: 'any'}
    }

    /**
     * Parse an enum declaration
     */
    private parseEnum(node: ts.EnumDeclaration, sourceFile: ts.SourceFile): ParsedType {
        const enumValues: (string | number)[] = []

        for (const member of node.members) {
            if (member.initializer) {
                if (ts.isStringLiteral(member.initializer)) {
                    enumValues.push(member.initializer.text)
                } else if (ts.isNumericLiteral(member.initializer)) {
                    enumValues.push(Number(member.initializer.text))
                }
            } else {
                // If no initializer, use the member name
                enumValues.push(member.name.getText(sourceFile))
            }
        }

        return {
            kind: 'enum',
            name: node.name.text,
            enumValues,
            description: this.extractJSDocComment(node)
        }
    }

    /**
     * Check if a type name is a primitive type
     */
    private isPrimitiveType(typeName: string): boolean {
        return ['string', 'number', 'boolean', 'void', 'any', 'unknown', 'undefined'].includes(typeName)
    }

    /**
     * Extract JSDoc comment from a node
     * Returns the cleaned comment text without the delimiters and asterisks
     */
    private extractJSDocComment(node: ts.Node): string | undefined {
        // Get the full text of JSDoc comments
        const fullText = node.getFullText()
        const nodeText = node.getText()
        const leadingText = fullText.substring(0, fullText.indexOf(nodeText))

        // Match JSDoc comments (/** ... */)
        const jsDocMatch = leadingText.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*$/)
        if (!jsDocMatch) {
            return undefined
        }

        // Extract and clean the comment text
        const commentBlock = jsDocMatch[1]
        const lines = commentBlock.split('\n')
            .map(line => line.trim())
            .map(line => line.replace(/^\*\s?/, ''))  // Remove leading asterisks
            .filter(line => !line.startsWith('@'))     // Remove @tag lines
            .filter(line => line.length > 0)           // Remove empty lines

        if (lines.length === 0) {
            return undefined
        }

        // Join lines and collapse multiple spaces
        return lines.join(' ').replace(/\s+/g, ' ').trim()
    }

    /**
     * Extract @example tag value from JSDoc comment
     */
    private extractJSDocExample(node: ts.Node): any {
        const fullText = node.getFullText()
        const nodeText = node.getText()
        const leadingText = fullText.substring(0, fullText.indexOf(nodeText))

        // Match JSDoc comments (/** ... */)
        const jsDocMatch = leadingText.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*$/)
        if (!jsDocMatch) {
            return undefined
        }

        const commentBlock = jsDocMatch[1]

        // Look for @example tag
        const exampleMatch = commentBlock.match(/@example\s+(.+?)(?=\n\s*\*\s*@|\n\s*\*\/|$)/s)
        if (!exampleMatch) {
            return undefined
        }

        let exampleValue = exampleMatch[1]
            .split('\n')
            .map(line => line.trim())
            .map(line => line.replace(/^\*\s?/, ''))  // Remove leading asterisks
            .join(' ')
            .trim()

        // Try to parse as JSON for objects/arrays
        if (exampleValue.startsWith('{') || exampleValue.startsWith('[')) {
            try {
                return JSON.parse(exampleValue)
            } catch {
                // If parse fails, return as string
                return exampleValue
            }
        }

        // Try to parse as number
        if (!isNaN(Number(exampleValue))) {
            return Number(exampleValue)
        }

        // Try to parse as boolean
        if (exampleValue === 'true') return true
        if (exampleValue === 'false') return false

        // Remove quotes if present
        if ((exampleValue.startsWith('"') && exampleValue.endsWith('"')) ||
            (exampleValue.startsWith("'") && exampleValue.endsWith("'"))) {
            return exampleValue.slice(1, -1)
        }

        return exampleValue
    }

    /**
     * Extract validator information from branded type definition
     * Parses the 'validator' property from intersection types
     *
     * Example:
     *   type tEmail = string & { tEmail: never, validator: IsEmail<tEmail> }
     *   → { className: "IsEmail", sourcePath: "@grest-ts/validator", arguments: [], typeArguments: [] }
     *
     *   type tStringRange<MIN, MAX> = string & { tStringRange: never, min: MIN, max: MAX, validator: IsStringRange<MIN, MAX> }
     *   For tStringRange<3, 10>:
     *   → { className: "IsStringRange", sourcePath: "@grest-ts/validator", arguments: [3, 10], typeArguments: [Type, Type] }
     */
    private extractBrandedTypeValidator(
        type: ts.Type,
        node: ts.TypeAliasDeclaration | undefined,
        sourceFile: ts.SourceFile,
        concreteTypeArguments?: ts.Type[] // For generic instantiations like tStringRange<3, 10>
    ): { className: string; sourcePath: string; arguments: (string | number)[]; typeArguments: ts.Type[] } | null {
        // Create cache key scoped by source file and type string
        const typeString = this.checker.typeToString(type)
        const sourceFilePath = node?.getSourceFile().fileName || sourceFile.fileName
        const cacheKey = this.getCacheKey(typeString, sourceFilePath)

        // Check cache first
        if (this.brandedTypeValidatorCache.has(cacheKey)) {
            return this.brandedTypeValidatorCache.get(cacheKey)!
        }

        verbose(`[extractBrandedTypeValidator] Extracting validator for: ${typeString} in ${sourceFilePath}`)

        // We need to look at the intersection type syntax to find the validator property
        if (!node || !ts.isIntersectionTypeNode(node.type)) {
            verbose(`[extractBrandedTypeValidator] Not an intersection type node`)
            this.brandedTypeValidatorCache.set(cacheKey, null)
            return null
        }

        // Find the object type in the intersection (the part with { validator: ... })
        const objectType = node.type.types.find(t => ts.isTypeLiteralNode(t)) as ts.TypeLiteralNode | undefined

        if (!objectType) {
            verbose(`[extractBrandedTypeValidator] No object literal in intersection`)
            this.brandedTypeValidatorCache.set(cacheKey, null)
            return null
        }

        // Find the 'validator' property
        const validatorProp = objectType.members.find(
            m => ts.isPropertySignature(m) &&
                m.name &&
                ts.isIdentifier(m.name) &&
                m.name.text === 'validator'
        ) as ts.PropertySignature | undefined

        if (!validatorProp || !validatorProp.type) {
            verbose(`[extractBrandedTypeValidator] No validator property found`)
            this.brandedTypeValidatorCache.set(cacheKey, null)
            return null
        }

        // The validator type should be a type reference (e.g., IsEmail<tEmail> or IsStringRange<MIN, MAX>)
        if (!ts.isTypeReferenceNode(validatorProp.type)) {
            verbose(`[extractBrandedTypeValidator] Validator is not a type reference`)
            this.brandedTypeValidatorCache.set(cacheKey, null)
            return null
        }

        // Get validator class name
        // IMPORTANT: Use the node's own source file, not the passed sourceFile parameter
        // The node is from the branded type definition file, but sourceFile might be from where it's used
        const nodeSourceFile = node.getSourceFile()
        const validatorClassName = validatorProp.type.typeName.getText(nodeSourceFile)
        verbose(`[extractBrandedTypeValidator] Validator class name: ${validatorClassName}`)

        // Resolve validator class to find its source path
        const validatorType = this.checker.getTypeAtLocation(validatorProp.type)
        const validatorSymbol = validatorType.getSymbol() || validatorType.aliasSymbol

        if (!validatorSymbol) {
            throw new CodeGeneratorError(
                `Failed to resolve validator class symbol for ${validatorClassName} in branded type ${node.name.text}`,
                {filePath: this.sourceFile.fileName, node}
            )
        }

        const validatorDeclarations = validatorSymbol.getDeclarations()
        if (!validatorDeclarations || validatorDeclarations.length === 0) {
            throw new CodeGeneratorError(
                `Failed to find declarations for validator class ${validatorClassName} in branded type ${node.name.text}`,
                {filePath: this.sourceFile.fileName, node}
            )
        }

        const validatorSourceFile = validatorDeclarations[0].getSourceFile()
        // Keep as absolute path - will be resolved to import specifier in FileImports
        const validatorSourcePath = validatorSourceFile.fileName
        verbose(`[extractBrandedTypeValidator] Validator source path: ${validatorSourcePath}`)

        // Extract type arguments if generic (e.g., IsStringRange<MIN, MAX>)
        const typeArguments: ts.Type[] = []
        const constructorArguments: (string | number)[] = []

        // Use concrete type arguments if provided (for instantiated generics like tStringRange<3, 10>)
        // Otherwise fall back to the validator property's type arguments (for base generic declarations)
        const typeArgsToUse = concreteTypeArguments ||
            (validatorProp.type.typeArguments ? validatorProp.type.typeArguments.map(ta => this.checker.getTypeAtLocation(ta)) : [])

        if (typeArgsToUse.length > 0) {
            verbose(`[extractBrandedTypeValidator] Found ${typeArgsToUse.length} type arguments`)

            for (const argType of typeArgsToUse) {
                typeArguments.push(argType)

                // Try to extract literal values for constructor arguments
                // This works for tStringRange<3, 10> where 3 and 10 are literal types
                if (argType.isNumberLiteral()) {
                    constructorArguments.push(argType.value)
                    verbose(`[extractBrandedTypeValidator] Extracted number argument: ${argType.value}`)
                } else if (argType.isStringLiteral()) {
                    constructorArguments.push(argType.value)
                    verbose(`[extractBrandedTypeValidator] Extracted string argument: ${argType.value}`)
                } else {
                    // For non-literal types (type parameters), we can't extract constructor args
                    verbose(`[extractBrandedTypeValidator] Type argument is not a literal: ${this.checker.typeToString(argType)}`)
                }
            }
        }

        const result = {
            className: validatorClassName,
            sourcePath: validatorSourcePath,
            arguments: constructorArguments,
            typeArguments
        }

        // Cache the result with source-file-scoped key
        this.brandedTypeValidatorCache.set(cacheKey, result)

        verbose(`[extractBrandedTypeValidator] Extracted validator:`, result)
        return result
    }

    /**
     * Parse error class extends clause and resolve error code immediately
     * Checks if the class extends GGHttpError (directly or indirectly)
     * Resolves the error code value now to avoid TypeChecker context issues later
     *
     * @param classNode The class declaration node
     * @returns ErrorClassInfo with resolved values and AST references, or null if not an error class
     */
    parseErrorClass(classNode: ts.ClassDeclaration): { baseClass: string; errorCodeValue: string; errorCodeIdentifier: string | null; dataTypeNode: ts.TypeNode; sourceFile: ts.SourceFile } | null {
        if (!classNode.heritageClauses) {
            return null
        }

        for (const clause of classNode.heritageClauses) {
            if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
                continue
            }

            for (const type of clause.types) {
                // Get base class name (e.g., "BAD_REQUEST", "NOT_FOUND")
                const baseClass = type.expression.getText(this.sourceFile)

                // Check if this extends GGHttpError (or a known error base class)
                if (!this.extendsGGHttpError(type, baseClass)) {
                    continue
                }

                // Error classes must have 2 type arguments: <errorCode, errorData>
                if (!type.typeArguments || type.typeArguments.length < 2) {
                    continue
                }

                const errorCodeNode = type.typeArguments[0]
                const dataTypeNode = type.typeArguments[1]

                // Resolve error code value immediately to avoid TypeChecker context issues later
                const resolved = this.resolveErrorCode(errorCodeNode, this.sourceFile)
                if (!resolved) {
                    // Skip if we can't resolve the error code
                    continue
                }

                verbose(`[parseErrorClass] Found error class extending ${baseClass} with code ${resolved.value}`)

                return {
                    baseClass,
                    errorCodeValue: resolved.value,
                    errorCodeIdentifier: resolved.identifier,
                    dataTypeNode,
                    sourceFile: this.sourceFile
                }
            }
        }

        return null
    }

    /**
     * Check if a type extends GGHttpError (directly or indirectly)
     * Uses quick check for known base classes, with TypeChecker fallback
     *
     * @param type The extends clause type
     * @param baseClassName The base class name from getText()
     * @returns true if this extends GGHttpError
     */
    private extendsGGHttpError(type: ts.ExpressionWithTypeArguments, baseClassName: string): boolean {
        // Check for direct GGHttpError extension
        if (baseClassName === 'GGHttpError') {
            return true
        }

        // Try TypeChecker to check inheritance chain
        try {
            const baseType = this.checker.getTypeAtLocation(type.expression)
            const baseSymbol = baseType.getSymbol()

            if (baseSymbol) {
                // Walk up the inheritance chain
                let currentType = baseType
                let depth = 0
                const maxDepth = 10  // Prevent infinite loops

                while (depth < maxDepth) {
                    const symbol = currentType.getSymbol()
                    if (symbol?.name === 'GGHttpError') {
                        return true
                    }

                    // Get base class
                    const baseTypes = currentType.getBaseTypes()
                    if (!baseTypes || baseTypes.length === 0) {
                        break
                    }

                    currentType = baseTypes[0]
                    depth++
                }
            }
        } catch (error) {
            // TypeChecker failed, rely on the known base class check above
            verbose(`[extendsGGHttpError] TypeChecker failed for ${baseClassName}, using fallback`)
        }

        return false
    }

    /**
     * Resolve error code value from AST node using TypeChecker
     * Handles string literals, typeof const, and enum members
     *
     * @param errorCodeNode AST node for the error code type argument
     * @param sourceFile Source file for the node
     * @returns Object with resolved value and optional identifier for code generation
     */
    resolveErrorCode(errorCodeNode: ts.TypeNode, sourceFile: ts.SourceFile): {
        value: string
        identifier: string | null
    } | null {
        const errorCodeText = errorCodeNode.getText(sourceFile)

        try {
            // Check if it's a direct string literal type first (most common case)
            // For example: "BAD_USERNAME"
            if (ts.isLiteralTypeNode(errorCodeNode) && ts.isStringLiteral(errorCodeNode.literal)) {
                return {
                    value: errorCodeNode.literal.text,
                    identifier: null
                }
            }

            // Try TypeChecker for more complex cases
            const errorCodeType = this.checker.getTypeAtLocation(errorCodeNode)

            // String literal type resolved by TypeChecker
            if (errorCodeType.isStringLiteral()) {
                return {
                    value: errorCodeType.value,
                    identifier: null
                }
            }

            // typeof CONST_NAME
            if (ts.isTypeQueryNode(errorCodeNode)) {
                const constName = errorCodeNode.exprName.getText(sourceFile)
                const symbol = this.checker.getSymbolAtLocation(errorCodeNode.exprName)

                if (symbol && symbol.valueDeclaration && ts.isVariableDeclaration(symbol.valueDeclaration)) {
                    const init = symbol.valueDeclaration.initializer
                    if (init && ts.isStringLiteral(init)) {
                        return {
                            value: init.text,
                            identifier: constName
                        }
                    }
                }
            }

            // ENUM.MEMBER (property access)
            if (ts.isTypeReferenceNode(errorCodeNode) && ts.isQualifiedName(errorCodeNode.typeName)) {
                const enumMemberType = this.checker.getTypeAtLocation(errorCodeNode)
                if (enumMemberType.isStringLiteral()) {
                    return {
                        value: enumMemberType.value,
                        identifier: errorCodeText
                    }
                }
            }

            // Direct identifier reference
            const symbol = this.checker.getSymbolAtLocation(errorCodeNode)
            if (symbol) {
                const resolvedType = this.checker.getTypeOfSymbolAtLocation(symbol, errorCodeNode)
                if (resolvedType.isStringLiteral()) {
                    return {
                        value: resolvedType.value,
                        identifier: errorCodeText
                    }
                }
            }
        } catch (error) {
            // TypeChecker can fail when resolving types from external modules or forward references
            // Fall back to AST-based extraction
            verbose(`[resolveErrorCode] TypeChecker failed for ${errorCodeText}, using AST fallback:`, error instanceof Error ? error.message : String(error))

            // Fallback 1: Direct string literal
            if (ts.isLiteralTypeNode(errorCodeNode) && ts.isStringLiteral(errorCodeNode.literal)) {
                return {
                    value: errorCodeNode.literal.text,
                    identifier: null
                }
            }

            // Fallback 2: typeof CONST_NAME - manually find the const
            if (ts.isTypeQueryNode(errorCodeNode)) {
                const constName = errorCodeNode.exprName.getText(sourceFile)
                // Find the const declaration in the source file
                const constValue = this.findConstValue(constName, sourceFile)
                if (constValue) {
                    return {
                        value: constValue,
                        identifier: constName
                    }
                }
            }

            // Fallback 3: ENUM.MEMBER - manually find the enum value
            if (ts.isTypeReferenceNode(errorCodeNode)) {
                const enumValue = this.findEnumMemberValue(errorCodeText, sourceFile)
                if (enumValue) {
                    return {
                        value: enumValue,
                        identifier: errorCodeText
                    }
                }
            }

            // Fallback 4: String literal in text (e.g., "BAD_USERNAME")
            const stringLiteralMatch = errorCodeText.match(/^"([^"]+)"$/)
            if (stringLiteralMatch) {
                return {
                    value: stringLiteralMatch[1],
                    identifier: null
                }
            }
        }

        verbose(`[resolveErrorCode] Could not resolve error code from: ${errorCodeText}`)
        return null
    }

    /**
     * Find const value by name in source file (fallback when TypeChecker fails)
     */
    private findConstValue(constName: string, sourceFile: ts.SourceFile): string | null {
        let value: string | null = null

        const visit = (node: ts.Node) => {
            if (ts.isVariableStatement(node)) {
                for (const decl of node.declarationList.declarations) {
                    if (ts.isIdentifier(decl.name) && decl.name.text === constName) {
                        if (decl.initializer && ts.isStringLiteral(decl.initializer)) {
                            value = decl.initializer.text
                            return
                        }
                    }
                }
            }
            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
        return value
    }

    /**
     * Find enum member value by qualified name (fallback when TypeChecker fails)
     * Example: "ITEM_ERRORS.ITEM_FULL" -> finds the value of ITEM_ERRORS.ITEM_FULL
     */
    private findEnumMemberValue(qualifiedName: string, sourceFile: ts.SourceFile): string | null {
        const parts = qualifiedName.split('.')
        if (parts.length !== 2) return null

        const [enumName, memberName] = parts
        let value: string | null = null

        const visit = (node: ts.Node) => {
            if (ts.isEnumDeclaration(node) && node.name.text === enumName) {
                for (const member of node.members) {
                    if (ts.isIdentifier(member.name) && member.name.text === memberName) {
                        if (member.initializer && ts.isStringLiteral(member.initializer)) {
                            value = member.initializer.text
                            return
                        }
                    }
                }
            }
            ts.forEachChild(node, visit)
        }

        visit(sourceFile)
        return value
    }
}
