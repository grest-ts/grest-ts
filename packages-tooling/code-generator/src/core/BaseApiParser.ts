import * as ts from 'typescript'
import * as fs from 'fs'
import {CodeGeneratorError, GeneratorOptions, mergeOptions, type ParsedType, ParserError, TypeExtractor, TypeValidator, warn} from '../index-node'

/**
 * BaseApiParser - Shared functionality for HTTP and WebSocket API parsers
 *
 * Contains common logic for:
 * - Parsing imports
 * - Extracting type definitions (interfaces, types, enums)
 * - Extracting JSDoc comments
 * - Type validation
 */
export abstract class BaseApiParser {
    protected sourceFile!: ts.SourceFile
    protected filePath!: string
    protected options: GeneratorOptions
    protected typeExtractor: TypeExtractor

    constructor(typeExtractor: TypeExtractor, opts?: GeneratorOptions) {
        this.typeExtractor = typeExtractor
        this.options = mergeOptions(opts)
    }

    /**
     * Create a TypeScript source file from a file path
     */
    protected createSourceFile(filePath: string): void {
        this.filePath = filePath
        const content = fs.readFileSync(filePath, 'utf-8')

        this.sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true // setParentNodes
        )

        // Set the active source file in TypeExtractor so type resolution prioritizes this file
        // This prevents cache collisions when multiple API files have types with the same name
        this.typeExtractor.setSourceFile(filePath)
    }

    /**
     * Parse imports from the file using AST
     * @param skipPatterns - Array of patterns to skip (e.g., 'httpApiDefinition', '@grest-ts/http')
     */
    protected parseImports(skipPatterns: string[]): Array<{ imports: string[], path: string, isTypeOnly: boolean }> {
        const imports: Array<{ imports: string[], path: string, isTypeOnly: boolean }> = []

        const visit = (node: ts.Node) => {
            if (ts.isImportDeclaration(node)) {
                const moduleSpecifier = node.moduleSpecifier
                if (ts.isStringLiteral(moduleSpecifier)) {
                    const source = moduleSpecifier.text

                    // Skip imports if the source path matches any skip pattern
                    if (skipPatterns.some(pattern => source.includes(pattern) || source === pattern)) {
                        return
                    }

                    const isTypeOnly = node.importClause?.isTypeOnly ?? false
                    const importNames: string[] = []

                    if (node.importClause?.namedBindings) {
                        const bindings = node.importClause.namedBindings
                        if (ts.isNamedImports(bindings)) {
                            for (const element of bindings.elements) {
                                const importName = element.name.text
                                // Skip individual imports if the name matches any skip pattern
                                if (!skipPatterns.includes(importName)) {
                                    importNames.push(importName)
                                }
                            }
                        }
                    }

                    if (importNames.length > 0) {
                        imports.push({
                            imports: importNames,
                            path: source,
                            isTypeOnly
                        })
                    }
                }
            }
            ts.forEachChild(node, visit)
        }

        visit(this.sourceFile)
        return imports
    }

    /**
     * Extract type definitions (interfaces, types, enums, classes, consts) from the AST
     * NOTE: Types are resolved here to enable proper import extraction
     */
    protected extractTypeDefinitions(): RawTypeDefinition[] {
        const types: RawTypeDefinition[] = []

        const visit = (node: ts.Node) => {
            // Interface declarations
            if (ts.isInterfaceDeclaration(node) && node.name) {
                const fullDefinition = node.getText(this.sourceFile)
                const typeName = node.name.text
                types.push({
                    name: typeName,
                    definition: fullDefinition,
                    kind: 'interface',
                    sourcePath: this.filePath,
                    parsed: this.typeExtractor.resolveType(typeName)
                })
            }

            // Type alias declarations
            if (ts.isTypeAliasDeclaration(node) && node.name) {
                const fullDefinition = node.getText(this.sourceFile)
                const typeName = node.name.text
                types.push({
                    name: typeName,
                    definition: fullDefinition,
                    kind: 'type',
                    sourcePath: this.filePath,
                    parsed: this.typeExtractor.resolveType(typeName)
                })
            }

            // Enum declarations
            if (ts.isEnumDeclaration(node) && node.name) {
                const fullDefinition = node.getText(this.sourceFile)
                const typeName = node.name.text
                types.push({
                    name: typeName,
                    definition: fullDefinition,
                    kind: 'enum',
                    sourcePath: this.filePath,
                    parsed: this.typeExtractor.resolveType(typeName)
                })
            }

            // Class declarations (including error classes)
            if (ts.isClassDeclaration(node) && node.name) {
                const fullDefinition = node.getText(this.sourceFile)
                const typeName = node.name.text

                // Parse error class information if this class extends an error base class
                const errorInfo = this.typeExtractor.parseErrorClass(node)

                types.push({
                    name: typeName,
                    definition: fullDefinition,
                    kind: 'class',
                    sourcePath: this.filePath,
                    parsed: this.typeExtractor.resolveType(typeName),
                    errorClassInfo: errorInfo || undefined
                })
            }

            // Const declarations (for error code constants)
            if (ts.isVariableStatement(node)) {
                for (const declaration of node.declarationList.declarations) {
                    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
                        // Check if this is an exported const
                        const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
                        const isConst = node.declarationList.flags & ts.NodeFlags.Const

                        if (isExported || isConst) {
                            const constName = declaration.name.text
                            const fullDefinition = node.getText(this.sourceFile)
                            types.push({
                                name: constName,
                                definition: fullDefinition,
                                kind: 'const',
                                sourcePath: this.filePath
                            })
                        }
                    }
                }
            }

            ts.forEachChild(node, visit)
        }

        visit(this.sourceFile)
        return types
    }

    /**
     * Extract JSDoc comment text from a node
     */
    protected extractJSDocText(node: ts.Node): string | undefined {
        const fullText = node.getFullText(this.sourceFile)
        const nodeText = node.getText(this.sourceFile)
        const leadingText = fullText.substring(0, fullText.indexOf(nodeText))

        // Match JSDoc comments (/** ... */)
        const jsDocMatch = leadingText.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*$/)
        if (!jsDocMatch) {
            return undefined
        }

        // Clean up the comment
        const commentBlock = jsDocMatch[1]
        const lines = commentBlock.split('\n')
            .map(line => line.trim())
            .map(line => line.replace(/^\*\s?/, ''))  // Remove leading asterisks
            .filter(line => !line.startsWith('@'))     // Remove @tag lines
            .filter(line => line.length > 0)           // Remove empty lines

        if (lines.length === 0) {
            return undefined
        }

        return lines.join(' ').replace(/\s+/g, ' ').trim()
    }

    /**
     * Check if JSDoc comment contains @deprecated tag
     */
    protected isJSDocDeprecated(node: ts.Node): boolean {
        const fullText = node.getFullText(this.sourceFile)
        const nodeText = node.getText(this.sourceFile)
        const leadingText = fullText.substring(0, fullText.indexOf(nodeText))

        const jsDocMatch = leadingText.match(/\/\*\*\s*([\s\S]*?)\s*\*\/\s*$/)
        if (!jsDocMatch) {
            return false
        }

        const commentBlock = jsDocMatch[1]
        return commentBlock.split('\n')
            .map(line => line.trim())
            .map(line => line.replace(/^\*\s?/, ''))
            .some(line => line.startsWith('@deprecated'))
    }

    /**
     * Find an interface declaration by name in the source file
     */
    protected findInterfaceByName(name: string): ts.InterfaceDeclaration | undefined {
        let result: ts.InterfaceDeclaration | undefined

        const visit = (node: ts.Node) => {
            if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
                result = node
                return
            }
            ts.forEachChild(node, visit)
        }

        visit(this.sourceFile)
        return result
    }

    /**
     * Validate a type node using TypeValidator
     */
    protected validateType(typeNode: ts.TypeNode, context: string): void {
        TypeValidator.validateType(typeNode, this.filePath, this.sourceFile, context)
    }

    /**
     * Parse a type literal node (object type) into property map
     * Used for both URL args and event maps
     */
    protected parseTypeLiteralProperties(typeLiteral: ts.TypeLiteralNode): Array<{ name: string, type: string, typeNode: ts.TypeNode }> {
        const properties: Array<{ name: string, type: string, typeNode: ts.TypeNode }> = []

        for (const member of typeLiteral.members) {
            if (ts.isPropertySignature(member) && member.name && member.type) {
                const name = member.name.getText(this.sourceFile)
                const type = member.type.getText(this.sourceFile).trim()

                properties.push({
                    name,
                    type,
                    typeNode: member.type
                })
            }
        }

        return properties
    }

    /**
     * Parse function type node to extract parameter info
     * Used for both HTTP endpoints and WebSocket events
     */
    protected parseFunctionType(funcType: ts.FunctionTypeNode): {
        parameters: Array<{ name: string, type: string, typeNode: ts.TypeNode, optional: boolean }>
        returnType: string
        returnTypeNode: ts.TypeNode
    } {
        const parameters: Array<{ name: string, type: string, typeNode: ts.TypeNode, optional: boolean }> = []

        for (const param of funcType.parameters) {
            if (!param.type) {
                throw CodeGeneratorError.parameterTypeError(
                    param.name.getText(this.sourceFile),
                    this.filePath,
                    param,
                    this.sourceFile
                )
            }

            const name = param.name.getText(this.sourceFile)
            const type = param.type.getText(this.sourceFile).trim()
            const optional = !!param.questionToken

            parameters.push({
                name,
                type,
                typeNode: param.type,
                optional
            })
        }

        return {
            parameters,
            returnType: funcType.type.getText(this.sourceFile).trim(),
            returnTypeNode: funcType.type
        }
    }

    /**
     * Result type for parsed function parameters with optional inline object wrapping
     */
    protected parseFunctionParametersForContract(
        funcType: ts.FunctionTypeNode,
        methodName: string
    ): {
        inputType: string
        inputTypeParsed?: any
        paramDeclaration?: string
        parameters: Array<{ name: string, type: string, optional: boolean }>
    } {
        const result = {
            inputType: 'void' as string,
            inputTypeParsed: undefined as any,
            paramDeclaration: undefined as string | undefined,
            parameters: [] as Array<{ name: string, type: string, optional: boolean }>
        }

        if (funcType.parameters.length === 0) {
            return result
        }

        // Validate all parameters have type annotations
        for (const param of funcType.parameters) {
            if (!param.type) {
                throw new ParserError(
                    `Parameter in method '${methodName}' must have a type annotation`,
                    this.filePath,
                    param,
                    this.sourceFile
                )
            }

            // Validate input type
            this.validateType(param.type, `input parameter of method '${methodName}'`)

            // Check for void in parameter types
            this.validateNoVoidInParameter(param.type, methodName)

            // Check for null in parameter types if not allowed
            if (!this.options.allowNull) {
                this.validateNoNullInParameter(param.type, methodName)
            }
        }

        if (funcType.parameters.length === 1) {
            // Single parameter - use type directly
            const param = funcType.parameters[0]
            result.inputType = param.type!.getText(this.sourceFile).trim()
            result.paramDeclaration = param.getText(this.sourceFile).trim()

            // Parse input type using TypeExtractor
            try {
                result.inputTypeParsed = this.typeExtractor?.['parseTypeReference'](param.type!, this.sourceFile)
            } catch (e) {
                warn(`[BaseApiParser] Warning: Failed to parse input type '${result.inputType}' for method '${methodName}' in ${this.filePath}:`, e instanceof Error ? e.message : String(e))
            }
        } else {
            // Multiple parameters - create inline object type
            // e.g., (item: ChecklistItem, reason?: string) => { item: ChecklistItem, reason?: string }
            const props: string[] = []
            for (const param of funcType.parameters) {
                const paramName = param.name.getText(this.sourceFile)
                const paramType = param.type!.getText(this.sourceFile).trim()
                const isOptional = param.questionToken !== undefined
                props.push(`${paramName}${isOptional ? '?' : ''}: ${paramType}`)
                result.parameters.push({name: paramName, type: paramType, optional: isOptional})
            }
            result.inputType = `{ ${props.join(', ')} }`
            // paramDeclaration stays undefined - will use 'data' as default
            // inputTypeParsed stays undefined - inline objects are handled by validator generator
        }

        return result
    }

    /**
     * Walk up the AST to find all chained method calls starting from a node
     */
    protected findChainedCalls(startNode: ts.CallExpression): ts.CallExpression[] {
        const chainNodes: ts.CallExpression[] = []
        let currentNode: ts.Node = startNode

        // Walk up the AST to find all chained calls
        while (currentNode.parent) {
            if (ts.isCallExpression(currentNode.parent)) {
                const callExpr = currentNode.parent
                if (ts.isPropertyAccessExpression(callExpr.expression)) {
                    chainNodes.push(callExpr)
                }
            }
            currentNode = currentNode.parent
        }

        return chainNodes
    }

    /**
     * Resolve the value of a constant identifier
     * Searches for variable declarations in the source file and returns the string value if found
     */
    protected resolveConstantValue(identifier: ts.Identifier): string | undefined {
        const identifierName = identifier.text

        // Search for the variable declaration in the source file
        let constantValue: string | undefined

        const visit = (node: ts.Node) => {
            if (ts.isVariableDeclaration(node)) {
                if (ts.isIdentifier(node.name) && node.name.text === identifierName && node.initializer) {
                    if (ts.isStringLiteral(node.initializer)) {
                        constantValue = node.initializer.text
                    }
                }
            }
            ts.forEachChild(node, visit)
        }

        visit(this.sourceFile)
        return constantValue
    }

    /**
     * Parse SDK names from .sdk() calls in method chain
     * Shared between HTTP and WebSocket API parsers
     */
    protected parseSdkNames(chainNodes: ts.CallExpression[]): string[] {
        const sdkNames: string[] = []

        for (const callNode of chainNodes) {
            const expr = callNode.expression
            if (!ts.isPropertyAccessExpression(expr)) continue

            const methodName = expr.name.text
            if (methodName === 'sdk') {
                // Extract SDK name from argument
                if (callNode.arguments.length === 0) {
                    throw new ParserError(
                        '.sdk() requires a string argument.\n  Example: .sdk("MobileApp")',
                        this.filePath,
                        callNode,
                        this.sourceFile
                    )
                }

                const arg = callNode.arguments[0]
                if (!ts.isStringLiteral(arg)) {
                    throw new ParserError(
                        '.sdk() argument must be a string literal.\n  Example: .sdk("MobileApp")',
                        this.filePath,
                        arg,
                        this.sourceFile
                    )
                }

                sdkNames.push(arg.text)
            }
        }

        return sdkNames
    }

    /**
     * Parse auth configuration from .auth<>() or .noAuth() call
     * Shared between HTTP and WebSocket parsers
     *
     * @param callNode The .auth() or .noAuth() call expression
     * @returns Auth configuration object
     */
    protected parseAuthConfig(callNode: ts.CallExpression): {
        type: 'none' | 'required'
        tokenType?: string
        userType?: string
        authStateType?: string
        entity?: string
    } {
        const expr = callNode.expression
        if (!ts.isPropertyAccessExpression(expr)) {
            throw new ParserError(
                'Expected property access expression for auth configuration',
                this.filePath,
                callNode,
                this.sourceFile
            )
        }

        const methodName = expr.name.text

        if (methodName === 'noAuth') {
            // No authentication required
            let entity: string | undefined
            if (callNode.arguments.length > 0) {
                const arg = callNode.arguments[0]
                if (ts.isStringLiteral(arg)) {
                    entity = arg.text
                } else if (ts.isIdentifier(arg)) {
                    entity = this.resolveConstantValue(arg)
                }
            }
            return {type: 'none', entity}
        }

        if (methodName === 'auth') {
            // Authentication required - extract token and user types
            if (!callNode.typeArguments || callNode.typeArguments.length < 2) {
                throw new ParserError(
                    '.auth() method requires 2 generic type arguments: .auth<AuthStrategy, AuthState>()\n  Example: .auth<MyUserAuth, MyUserAuthState>()',
                    this.filePath,
                    callNode,
                    this.sourceFile
                )
            }

            const authStrategyTypeNode = callNode.typeArguments[0]
            const authStateTypeNode = callNode.typeArguments[1]

            const authStrategyType = authStrategyTypeNode.getText(this.sourceFile).trim()
            const authStateType = authStateTypeNode.getText(this.sourceFile).trim()

            // Validate types
            this.validateType(authStrategyTypeNode, 'auth strategy type')
            this.validateType(authStateTypeNode, 'auth state type')

            // Extract actual token and user types from the auth strategy/state classes
            // AuthStrategy implements GGAuthStrategy<TokenType, UserType>
            // AuthState extends GGAuthState<AuthType, TokenType, UserType>
            let tokenType: string | undefined
            let userType: string | undefined

            // Try to extract from AuthStrategy first (implements GGAuthStrategy<Token, User>)
            const strategyGenerics = this.extractGenericArgumentsFromHeritage(authStrategyType, 'GGAuthStrategy')
            if (strategyGenerics && strategyGenerics.length >= 2) {
                tokenType = strategyGenerics[0]
                userType = strategyGenerics[1]
            }

            // If not found, try AuthState (extends GGAuthState<Auth, Token, User>)
            if (!tokenType || !userType) {
                const stateGenerics = this.extractGenericArgumentsFromHeritage(authStateType, 'GGAuthState')
                if (stateGenerics && stateGenerics.length >= 3) {
                    // GGAuthState<AuthType, TokenType, UserType> - we want indices [1] and [2]
                    tokenType = stateGenerics[1]
                    userType = stateGenerics[2]
                }
            }

            // If still not found, fall back to the provided types (for backward compatibility)
            if (!tokenType || !userType) {
                tokenType = authStrategyType
                userType = authStateType
            }

            // Extract entity argument if provided
            let entity: string | undefined
            if (callNode.arguments.length > 0) {
                const arg = callNode.arguments[0]
                if (ts.isStringLiteral(arg)) {
                    entity = arg.text
                } else if (ts.isIdentifier(arg)) {
                    entity = this.resolveConstantValue(arg)
                }
            }

            return {
                type: 'required',
                tokenType,
                userType,
                authStateType,
                entity
            }
        }

        throw new ParserError(
            `Unexpected method name '${methodName}' in auth configuration`,
            this.filePath,
            callNode,
            this.sourceFile
        )
    }

    /**
     * Extract generic type arguments from a type's extends/implements clause
     *
     * For example, if MyUserAuth implements GGAuthStrategy<tUserAuthToken, UserAuthData>,
     * this will return ['tUserAuthToken', 'UserAuthData']
     *
     * @param typeName The type to analyze (e.g., 'MyUserAuth')
     * @param baseClassName The base class to look for (e.g., 'GGAuthStrategy' or 'GGAuthState')
     * @returns Array of generic type arguments, or null if not found
     */
    protected extractGenericArgumentsFromHeritage(typeName: string, baseClassName: string): string[] | null {
        // Find the type declaration in the source file
        const typeDeclaration = this.findTypeDeclaration(typeName)
        if (!typeDeclaration) {
            return null
        }

        // Look for heritage clauses (extends/implements)
        if (!typeDeclaration.heritageClauses) {
            return null
        }

        for (const heritage of typeDeclaration.heritageClauses) {
            for (const type of heritage.types) {
                const exprText = type.expression.getText(this.sourceFile)

                // Check if this is the base class we're looking for
                if (exprText === baseClassName) {
                    // Extract generic type arguments
                    if (type.typeArguments && type.typeArguments.length > 0) {
                        return type.typeArguments.map(arg => arg.getText(this.sourceFile).trim())
                    }
                }
            }
        }

        return null
    }

    /**
     * Find a class or interface declaration by name in the source file
     */
    protected findTypeDeclaration(typeName: string): ts.ClassDeclaration | ts.InterfaceDeclaration | null {
        let found: ts.ClassDeclaration | ts.InterfaceDeclaration | null = null

        const visit = (node: ts.Node) => {
            if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
                if (node.name && node.name.text === typeName) {
                    found = node
                    return
                }
            }
            ts.forEachChild(node, visit)
        }

        visit(this.sourceFile)
        return found
    }

    /**
     * Validate that void is not used in parameter types
     * void as a parameter type doesn't make semantic sense - use optional parameters instead
     */
    protected validateNoVoidInParameter(typeNode: ts.TypeNode, paramName: string): void {
        const containsVoid = this.typeContainsVoid(typeNode)
        if (containsVoid) {
            throw new ParserError(
                `Parameter '${paramName}' cannot use 'void' type.\n` +
                `  void is only valid as a return type.\n` +
                `  For optional parameters, use: ${paramName}?: Type`,
                this.filePath,
                typeNode,
                this.sourceFile
            )
        }
    }

    /**
     * Validate that null is not used in parameter types (when allowNull is false)
     */
    protected validateNoNullInParameter(typeNode: ts.TypeNode, paramName: string): void {
        const containsNull = this.typeContainsNull(typeNode)
        if (containsNull) {
            throw new ParserError(
                `Parameter '${paramName}' cannot use 'null' type (allowNull is disabled).\n` +
                `  Use 'undefined' for optional values: ${paramName}?: Type\n` +
                `  Or enable null types in generator options: { allowNull: true }`,
                this.filePath,
                typeNode,
                this.sourceFile
            )
        }
    }

    /**
     * Generic helper to check if a type contains a specific kind
     * Recursively searches through union types and arrays
     *
     * @param typeNode The type node to search
     * @param predicate Function to check if a node matches the desired kind
     * @returns true if any node matches the predicate
     */
    protected typeContains(
        typeNode: ts.TypeNode,
        predicate: (node: ts.TypeNode) => boolean
    ): boolean {
        // Check if current node matches
        if (predicate(typeNode)) {
            return true
        }

        // Check union types recursively
        if (ts.isUnionTypeNode(typeNode)) {
            return typeNode.types.some(t => this.typeContains(t, predicate))
        }

        // Check arrays recursively
        if (ts.isArrayTypeNode(typeNode)) {
            return this.typeContains(typeNode.elementType, predicate)
        }

        return false
    }

    /**
     * Check if a type contains void
     */
    protected typeContainsVoid(typeNode: ts.TypeNode): boolean {
        return this.typeContains(typeNode, node =>
            node.kind === ts.SyntaxKind.VoidKeyword
        )
    }

    /**
     * Check if a type contains null
     */
    protected typeContainsNull(typeNode: ts.TypeNode): boolean {
        return this.typeContains(typeNode, node =>
            node.kind === ts.SyntaxKind.NullKeyword ||
            (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword)
        )
    }

    /**
     * Parse GGResultPromise<Success, Errors> return type
     * This is used by both HTTP and WebSocket parsers to extract error types from GGResultPromise
     */
    protected parseGGResultPromiseReturnType(
        returnTypeNode: ts.TypeNode,
        methodName: string,
        allowNonPromise: boolean = false
    ): { successType: { typeString: string, typeParsed: any }, errorsType: { typeString: string, typeParsed: any } | null } {
        // Check if it's a GGResultPromise type reference
        if (!ts.isTypeReferenceNode(returnTypeNode)) {
            if (allowNonPromise) {
                // For WebSocket, allow non-GGResultPromise types (void, etc.)
                const typeString = returnTypeNode.getText(this.sourceFile).trim()
                return {
                    successType: {
                        typeString,
                        typeParsed: undefined
                    },
                    errorsType: null
                }
            }
            throw new ParserError(
                `Method '${methodName}' return type must be GGResultPromise<SuccessType, ErrorsType?> or GGPromise<SuccessType, ErrorsType?>`,
                this.filePath,
                returnTypeNode,
                this.sourceFile
            )
        }

        const typeName = returnTypeNode.typeName.getText(this.sourceFile)
        if (typeName !== 'GGResultPromise' && typeName !== 'GGPromise') {
            if (allowNonPromise) {
                // For WebSocket, allow non-GGResultPromise types (return the full type)
                const typeString = returnTypeNode.getText(this.sourceFile).trim()
                let typeParsed
                try {
                    typeParsed = this.typeExtractor?.['parseTypeReference'](returnTypeNode, this.sourceFile)
                } catch (e) {
                    warn(`[BaseApiParser] Warning: Failed to parse return type '${typeString}' for method '${methodName}':`, e instanceof Error ? e.message : String(e))
                }
                return {
                    successType: {
                        typeString,
                        typeParsed
                    },
                    errorsType: null
                }
            }
            throw new ParserError(
                `Method '${methodName}' return type must be GGResultPromise or GGPromise, found '${typeName}'`,
                this.filePath,
                returnTypeNode,
                this.sourceFile
            )
        }

        if (!returnTypeNode.typeArguments || returnTypeNode.typeArguments.length === 0) {
            throw new ParserError(
                `Method '${methodName}' ${typeName} must have at least one type argument (success type)`,
                this.filePath,
                returnTypeNode,
                this.sourceFile
            )
        }

        // First type argument: Success type
        const successTypeNode = returnTypeNode.typeArguments[0]
        const successTypeString = successTypeNode.getText(this.sourceFile).trim()
        let successTypeParsed
        try {
            successTypeParsed = this.typeExtractor?.['parseTypeReference'](successTypeNode, this.sourceFile)
        } catch (e) {
            warn(`[BaseApiParser] Warning: Failed to parse success type '${successTypeString}' for method '${methodName}':`, e instanceof Error ? e.message : String(e))
        }

        // Second type argument (optional): Errors type
        let errorsType: { typeString: string, typeParsed: any } | null = null
        if (returnTypeNode.typeArguments.length >= 2) {
            const errorsTypeNode = returnTypeNode.typeArguments[1]
            const errorsTypeString = errorsTypeNode.getText(this.sourceFile).trim()
            let errorsTypeParsed
            try {
                errorsTypeParsed = this.typeExtractor?.['parseTypeReference'](errorsTypeNode, this.sourceFile)
            } catch (e) {
                warn(`[BaseApiParser] Warning: Failed to parse errors type '${errorsTypeString}' for method '${methodName}':`, e instanceof Error ? e.message : String(e))
            }
            errorsType = {
                typeString: errorsTypeString,
                typeParsed: errorsTypeParsed
            }
        }

        return {
            successType: {
                typeString: successTypeString,
                typeParsed: successTypeParsed
            },
            errorsType
        }
    }
}

export interface RawTypeDefinition {
    name: string
    definition: string
    kind: 'interface' | 'type' | 'enum' | 'class' | 'const'
    sourcePath?: string
    isImported?: boolean
    description?: string
    parsed?: ParsedType
    errorClassInfo?: ErrorClassInfo
}

/**
 * Information extracted from error class definitions
 */
export interface ErrorClassInfo {
    baseClass: string
    errorCodeValue: string
    errorCodeIdentifier: string | null
    dataTypeNode: any // ts.TypeNode
    sourceFile: any // ts.SourceFile
}
