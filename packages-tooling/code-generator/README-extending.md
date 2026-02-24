# Code Generation Plugins

How to extend the Grest Framework code generator with custom parsers and builders.

## Overview

The code generator processes `.api.ts` files and generates:
- Type contracts with validators
- Client code for making requests
- Server code for handling requests

You can extend this by creating:
- **Parsers** - Extract information from source files
- **Builders** - Generate output files

## Package Setup

Enable code generation extensions in your package:

```typescript
// packages/my-package/grest.package.ts
import { definePackage } from "@grest-ts/x-packager"

definePackage({
    name: "@grest-ts/my-package",
    description: "My package with codegen support",
    targets: { node: true },
    extendsCodeGen: true,      // Adds ./codegen export
    hasCodegenTests: true      // Has codegen tests
})
```

## Directory Structure

```
packages/my-package/
├── codegen/
│   ├── index-codegen.ts       # Entry point
│   ├── MyApiParser.ts         # Parser implementation
│   ├── MyBuilder.ts           # Builder implementation
│   └── test/
│       └── mycodegen.test.ts  # Tests
└── src/
    └── ...                    # Runtime code
```

## Creating a Parser

Parsers extract information from TypeScript source files.

```typescript
// codegen/MyApiParser.ts
import { BaseApiParser, ParsedType } from "@grest-ts/code-generator"
import ts from "typescript"

export interface MyApiDefinition {
    name: string
    methods: MyMethodDefinition[]
    types: ParsedType[]
}

export interface MyMethodDefinition {
    name: string
    parameters: Array<{ name: string; type: ParsedType }>
    returnType: ParsedType
}

export class MyApiParser extends BaseApiParser {
    /**
     * Check if this file contains our API definition
     */
    canParse(sourceFile: ts.SourceFile): boolean {
        // Look for our marker function call
        return this.findCallExpression(sourceFile, "myApiDefinition") !== undefined
    }

    /**
     * Parse the API definition from source file
     */
    parse(sourceFile: ts.SourceFile): MyApiDefinition {
        const callExpr = this.findCallExpression(sourceFile, "myApiDefinition")!

        return {
            name: this.extractApiName(callExpr),
            methods: this.extractMethods(callExpr),
            types: this.extractTypes(sourceFile)
        }
    }

    private extractApiName(callExpr: ts.CallExpression): string {
        // Extract first argument as API name
        const args = callExpr.arguments
        if (args.length > 0 && ts.isStringLiteral(args[0])) {
            return args[0].text
        }
        throw new Error("API name must be a string literal")
    }

    private extractMethods(callExpr: ts.CallExpression): MyMethodDefinition[] {
        // Parse method definitions from call expression
        // Implementation depends on your API definition syntax
        return []
    }
}
```

## Creating a Builder

Builders generate output files from parsed definitions.

```typescript
// codegen/MyBuilder.ts
import { File, FileChunk, FileImports, TypeConverter } from "@grest-ts/code-generator"
import { MyApiDefinition } from "./MyApiParser"

export class MyBuilder {
    constructor(
        private definition: MyApiDefinition,
        private typeConverter: TypeConverter
    ) {}

    /**
     * Generate contract file with types and validators
     */
    buildContract(): File {
        const file = new File(`${this.definition.name}.gen.ts`)

        // Add imports
        file.addImport("@grest-ts/schema", ["IsString", "IsNumber"])

        // Add type definitions
        for (const type of this.definition.types) {
            file.addChunk(this.generateTypeDefinition(type))
        }

        // Add contract object
        file.addChunk(this.generateContract())

        return file
    }

    /**
     * Generate client file
     */
    buildClient(): File {
        const file = new File(`${this.definition.name}Client.gen.ts`)

        file.addImport(`./${this.definition.name}.gen`, [
            `${this.definition.name}Contract`
        ])

        file.addChunk(this.generateClientClass())

        return file
    }

    private generateTypeDefinition(type: ParsedType): FileChunk {
        return new FileChunk(`
export interface ${type.name} {
${type.properties.map(p => `    ${p.name}: ${this.typeConverter.convert(p.type)}`).join("\n")}
}
`)
    }

    private generateContract(): FileChunk {
        return new FileChunk(`
export const ${this.definition.name}Contract = {
    name: "${this.definition.name}",
    methods: {
${this.definition.methods.map(m => `        ${m.name}: { ... }`).join(",\n")}
    }
}
`)
    }

    private generateClientClass(): FileChunk {
        return new FileChunk(`
export class ${this.definition.name}Client {
${this.definition.methods.map(m => this.generateClientMethod(m)).join("\n")}
}
`)
    }

    private generateClientMethod(method: MyMethodDefinition): string {
        const params = method.parameters
            .map(p => `${p.name}: ${this.typeConverter.convert(p.type)}`)
            .join(", ")

        return `
    async ${method.name}(${params}): Promise<${this.typeConverter.convert(method.returnType)}> {
        // Implementation
    }
`
    }
}
```

## Registering with Code Generator

Export your parser and builder from the codegen entry point:

```typescript
// codegen/index-codegen.ts
import { CodegenRegistry } from "@grest-ts/code-generator"
import { MyApiParser } from "./MyApiParser"
import { MyBuilder } from "./MyBuilder"

// Register parser
CodegenRegistry.registerParser("myApi", {
    pattern: /myApiDefinition\s*\(/,
    parser: MyApiParser,
    builder: MyBuilder
})

// Re-export for users
export { MyApiParser } from "./MyApiParser"
export { MyBuilder } from "./MyBuilder"
```

## Using File and FileChunk

### Creating Files

```typescript
import { File, FileChunk, FileImports } from "@grest-ts/code-generator"

// Create a new file
const file = new File("output.gen.ts")

// Add imports
file.addImport("@grest-ts/schema", ["IsString", "IsNumber", "IsBoolean"])
file.addImport("./types", ["MyType"], true)  // type-only import

// Add content chunks
file.addChunk(new FileChunk(`
export interface MyInterface {
    name: string
    value: number
}
`))

// Get final content
const content = file.toString()
```

### Managing Imports

```typescript
const imports = new FileImports()

// Add regular import
imports.add("@grest-ts/http", ["httpApi", "GGPromise"])

// Add type import
imports.addType("./types", ["MyType", "MyOptions"])

// Add default import
imports.addDefault("express", "express")

// Generate import statements
const importStatements = imports.toString()
```

## Type Conversion

Use TypeConverter to convert parsed types to TypeScript strings:

```typescript
import { TypeConverter, ParsedType } from "@grest-ts/code-generator"

const converter = new TypeConverter()

// Convert simple types
converter.convert({ kind: "string" })  // "string"
converter.convert({ kind: "number" })  // "number"

// Convert complex types
converter.convert({
    kind: "object",
    properties: [
        { name: "id", type: { kind: "string" } },
        { name: "count", type: { kind: "number" } }
    ]
})  // "{ id: string; count: number }"

// Convert arrays
converter.convert({
    kind: "array",
    elementType: { kind: "string" }
})  // "string[]"

// Convert unions
converter.convert({
    kind: "union",
    types: [{ kind: "string" }, { kind: "null" }]
})  // "string | null"
```

## Validator Generation

Generate runtime validators for types:

```typescript
import { ValidatorGenerator } from "@grest-ts/code-generator"

const generator = new ValidatorGenerator()

// Generate validator for interface
const validator = generator.generate({
    kind: "object",
    name: "CreateUserRequest",
    properties: [
        { name: "email", type: { kind: "branded", brand: "tEmail" } },
        { name: "age", type: { kind: "branded", brand: "tPosInt" } },
        { name: "name", type: { kind: "string" }, optional: true }
    ]
})

// Output:
// {
//     email: IsEmail,
//     age: IsPosInt,
//     name: optional(IsString)
// }
```

## Testing Code Generation

```typescript
// codegen/test/mycodegen.test.ts
import { describe, test, expect } from "vitest"
import { MyApiParser } from "../MyApiParser"
import { MyBuilder } from "../MyBuilder"
import { compareGeneratedCode } from "@grest-ts/code-generator"
import ts from "typescript"

describe("MyApiParser", () => {
    test("parses basic API definition", () => {
        const source = `
            import { myApiDefinition } from "@grest-ts/my-package"

            export const MyApi = myApiDefinition("MyApi")
                .method("getUser", (id: string) => User)
        `

        const sourceFile = ts.createSourceFile(
            "test.api.ts",
            source,
            ts.ScriptTarget.Latest
        )

        const parser = new MyApiParser()
        expect(parser.canParse(sourceFile)).toBe(true)

        const definition = parser.parse(sourceFile)
        expect(definition.name).toBe("MyApi")
        expect(definition.methods).toHaveLength(1)
    })
})

describe("MyBuilder", () => {
    test("generates correct contract", () => {
        const definition = {
            name: "TestApi",
            methods: [
                { name: "getUser", parameters: [], returnType: { kind: "string" } }
            ],
            types: []
        }

        const builder = new MyBuilder(definition, new TypeConverter())
        const contractFile = builder.buildContract()

        const expected = `
export const TestApiContract = {
    name: "TestApi",
    methods: {
        getUser: { ... }
    }
}
`
        expect(compareGeneratedCode(contractFile.toString(), expected)).toBe(true)
    })
})
```

## Example: HTTP API Codegen

The `@grest-ts/http` package's codegen structure:

```
packages/http/codegen/
├── index-codegen.ts              # Entry point
├── common/
│   ├── AuthParser.ts             # Parse auth state
│   ├── JsonSchemaGenerator.ts    # Generate JSON schemas
│   └── autoLinkContracts.ts      # Auto-link contracts
├── http/
│   ├── HttpApiParser.ts          # Parse httpApi() definitions
│   ├── HttpBuilder.ts            # Generate HTTP client/server
│   ├── HttpContractBuilder.ts    # Generate contracts
│   └── HttpInlineTypeExtractor.ts
├── websocket/
│   ├── WebSocketApiParser.ts     # Parse websocket definitions
│   ├── WebSocketBuilder.ts       # Generate WebSocket code
│   └── WebSocketContractBuilder.ts
└── test/
    └── *.test.ts
```

## Best Practices

### Parser Design
- Use AST traversal, not string parsing
- Handle edge cases (optional types, generics)
- Provide clear error messages with source locations

### Builder Design
- Generate readable, formatted code
- Include necessary imports automatically
- Support incremental generation (don't regenerate unchanged files)

### Testing
- Test parser with various input patterns
- Compare generated output against expected files
- Test edge cases (empty inputs, complex types)

### Error Handling
- Include file path and line numbers in errors
- Validate inputs before generation
- Fail fast with clear messages