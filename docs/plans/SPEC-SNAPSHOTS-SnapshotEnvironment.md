# SPEC: TypeScript Snapshots via Custom SnapshotEnvironment

## Overview

Integrate TypeScript-based snapshot testing into Vitest by implementing a custom `SnapshotEnvironment`. This approach provides full type safety, IDE support, and proper TypeScript compilation while maintaining Vitest's native snapshot workflow (including `-u` flag support).

## Goals

1. **Type-Safe Snapshots**: Snapshot files are valid TypeScript that compile and type-check
2. **IDE Integration**: Full autocomplete, refactoring, and navigation support
3. **Type References**: Link to actual interface definitions from the codebase
4. **Dynamic Matchers**: Support `expect.any(String)`, `expect.any(Number)`, custom matchers
5. **Vitest Integration**: Use standard Vitest workflow (`vitest -u` to update, snapshot diffing)
6. **Two Modes**: Support both inline snapshots and separate `.snapshot.ts` files
7. **Valid TypeScript**: All snapshot files must compile without errors

## Architecture

### File Structure

```
test/
├── exampleTest1.test.ts          # Test file
├── exampleTest1.snapshot.ts      # External snapshots (optional)
└── __snapshots__/                # Not used (we replace with .snapshot.ts)
```

### Snapshot File Format

External snapshots (`.snapshot.ts`):

```typescript
import { SNAPSHOTS } from "@grest-ts/test"
import { LoginResponse } from "../src/api/UserApi.api"
import { tUserAuthToken } from "../src/api/types"

export const exampleTest1Snapshots = SNAPSHOTS({
    testSuite1: {
        testName1: {
            snap1: {
                token: "" as tUserAuthToken,
                user: {
                    id: expect.any(String),
                    username: "alice",
                    email: "alice@example.com",
                }
            } satisfies LoginResponse,

            namedSnapshot: {
                status: "success",
                count: expect.any(Number)
            }
        }
    }
})
```

Inline snapshots (in test file):

```typescript
test("user registration", async () => {
    const result = await alice.userPublic.register(aliceData)

    expect(result).toMatchInlineSnapshot<LoginResponse>({
        token: "" as tUserAuthToken,
        user: {
            id: expect.any(String),
            username: "alice",
            email: "alice@example.com",
        }
    })
})
```

## Test API

### External Snapshots

```typescript
// Automatic snapshot key generation
test("user registration", async () => {
    const result = await alice.userPublic.register(aliceData)
    expect(result).toMatchSnapshot()
    // Looks up: exampleTest1Snapshots.testSuiteName.testName.snap1
})

// Named snapshots
test("user registration", async () => {
    const result = await alice.userPublic.register(aliceData)
    expect(result).toMatchSnapshot("customName")
    // Looks up: exampleTest1Snapshots.testSuiteName.testName.customName
})

// Multiple snapshots in one test
test("user flow", async () => {
    const register = await alice.userPublic.register(aliceData)
    expect(register).toMatchSnapshot("register")

    const login = await alice.userPublic.login(loginData)
    expect(login).toMatchSnapshot("login")
})
```

### Inline Snapshots

```typescript
// Basic inline snapshot
test("user registration", async () => {
    const result = await alice.userPublic.register(aliceData)
    expect(result).toMatchInlineSnapshot<LoginResponse>()
    // On first run with -u, Vitest updates the test file:
    // expect(result).toMatchInlineSnapshot<LoginResponse>({
    //     token: "...",
    //     user: { ... }
    // })
})

// Pre-filled inline snapshot
test("user registration", async () => {
    const result = await alice.userPublic.register(aliceData)
    expect(result).toMatchInlineSnapshot<LoginResponse>({
        token: expect.any(String),
        user: {
            id: expect.any(String),
            username: "alice",
            email: "alice@example.com",
        }
    })
})
```

## Implementation Components

### 1. Custom SnapshotEnvironment

```typescript
// packages/test/src/snapshot/TypeScriptSnapshotEnvironment.ts
import type { SnapshotEnvironment } from 'vitest/snapshot'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Project, VariableDeclarationKind } from 'ts-morph'

export class TypeScriptSnapshotEnvironment implements SnapshotEnvironment {
    private project: Project

    constructor() {
        this.project = new Project({
            compilerOptions: {
                strict: true,
                skipLibCheck: true,
            }
        })
    }

    getVersion(): string {
        return '1'
    }

    getHeader(): string {
        return '// TypeScript Snapshot v1\n'
    }

    async resolvePath(testPath: string): Promise<string> {
        const dir = path.dirname(testPath)
        const filename = path.basename(testPath, '.test.ts')
        return path.join(dir, `${filename}.snapshot.ts`)
    }

    async resolveRawPath(testPath: string, rawPath: string): Promise<string> {
        if (path.isAbsolute(rawPath)) {
            return rawPath
        }
        return path.resolve(path.dirname(testPath), rawPath)
    }

    async saveSnapshotFile(filepath: string, snapshot: string): Promise<void> {
        // Parse Vitest's internal snapshot format
        const snapshots = this.parseVitestSnapshot(snapshot)

        // Convert to TypeScript AST
        const tsContent = await this.generateTypeScriptFile(filepath, snapshots)

        // Write file
        await fs.mkdir(path.dirname(filepath), { recursive: true })
        await fs.writeFile(filepath, tsContent, 'utf-8')
    }

    async readSnapshotFile(filepath: string): Promise<string | null> {
        try {
            const content = await fs.readFile(filepath, 'utf-8')

            // Parse TypeScript snapshot file
            const snapshots = await this.parseTypeScriptSnapshot(filepath, content)

            // Convert to Vitest's internal format
            return this.convertToVitestFormat(snapshots)
        } catch (error) {
            return null
        }
    }

    async removeSnapshotFile(filepath: string): Promise<void> {
        try {
            await fs.unlink(filepath)
        } catch {
            // Ignore if doesn't exist
        }
    }

    private parseVitestSnapshot(snapshot: string): Map<string, any> {
        // Parse exports[`key`] = `value`; format
        // This is Vitest's internal representation
        const snapshots = new Map<string, any>()

        const exportRegex = /exports\[`([^`]+)`\]\s*=\s*`([^`]*)`/g
        let match

        while ((match = exportRegex.exec(snapshot)) !== null) {
            const [, key, value] = match
            snapshots.set(key, JSON.parse(value))
        }

        return snapshots
    }

    private async generateTypeScriptFile(
        filepath: string,
        snapshots: Map<string, any>
    ): Promise<string> {
        // Group snapshots by test suite/name
        const grouped = this.groupSnapshotsByTest(snapshots)

        // Use ts-morph to generate valid TypeScript
        const sourceFile = this.project.createSourceFile(filepath, '', { overwrite: true })

        // Add imports
        sourceFile.addImportDeclaration({
            moduleSpecifier: '@grest-ts/test',
            namedImports: ['SNAPSHOTS']
        })

        // TODO: Detect and add type imports from actual values
        // This requires type inference from the snapshot data

        // Add snapshot export
        const snapshotName = path.basename(filepath, '.snapshot.ts') + 'Snapshots'
        sourceFile.addVariableStatement({
            declarationKind: VariableDeclarationKind.Const,
            isExported: true,
            declarations: [{
                name: snapshotName,
                initializer: `SNAPSHOTS(${this.objectToTypeScript(grouped)})`
            }]
        })

        return sourceFile.getFullText()
    }

    private async parseTypeScriptSnapshot(
        filepath: string,
        content: string
    ): Promise<Map<string, any>> {
        // Use ts-morph to parse TypeScript
        const sourceFile = this.project.createSourceFile(filepath, content, { overwrite: true })

        // Find the SNAPSHOTS() call
        const snapshotCall = sourceFile.getDescendantsOfKind(
            ts.SyntaxKind.CallExpression
        ).find(call => call.getExpression().getText() === 'SNAPSHOTS')

        if (!snapshotCall) {
            throw new Error('No SNAPSHOTS() call found')
        }

        // Extract the object literal
        const objectLiteral = snapshotCall.getArguments()[0]

        // Convert AST back to runtime values
        const snapshots = await this.evaluateSnapshotObject(objectLiteral)

        // Flatten to Map<string, any> for Vitest
        return this.flattenSnapshots(snapshots)
    }

    private convertToVitestFormat(snapshots: Map<string, any>): string {
        const lines: string[] = []

        lines.push(`// Vitest Snapshot v${this.getVersion()}, https://vitest.dev/guide/snapshot.html`)
        lines.push('')

        for (const [key, value] of snapshots) {
            lines.push(`exports[\`${key}\`] = \`${JSON.stringify(value, null, 2)}\`;`)
            lines.push('')
        }

        return lines.join('\n')
    }

    private groupSnapshotsByTest(snapshots: Map<string, any>): any {
        // Convert flat "suite > test > name" keys to nested object
        const grouped: any = {}

        for (const [key, value] of snapshots) {
            const parts = key.split(' > ')
            let current = grouped

            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) {
                    current[parts[i]] = {}
                }
                current = current[parts[i]]
            }

            current[parts[parts.length - 1]] = value
        }

        return grouped
    }

    private flattenSnapshots(nested: any, prefix = ''): Map<string, any> {
        // Convert nested object to flat "suite > test > name" keys
        const flat = new Map<string, any>()

        for (const [key, value] of Object.entries(nested)) {
            const fullKey = prefix ? `${prefix} > ${key}` : key

            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                // Check if this is a snapshot value or nested structure
                if (this.isSnapshotValue(value)) {
                    flat.set(fullKey, value)
                } else {
                    // Recurse
                    const nested = this.flattenSnapshots(value, fullKey)
                    for (const [k, v] of nested) {
                        flat.set(k, v)
                    }
                }
            } else {
                flat.set(fullKey, value)
            }
        }

        return flat
    }

    private isSnapshotValue(obj: any): boolean {
        // Heuristic: if object has no nested objects (except arrays), it's a snapshot
        for (const value of Object.values(obj)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                return false
            }
        }
        return true
    }

    private objectToTypeScript(obj: any, indent = 0): string {
        // Convert object to TypeScript object literal syntax
        // Handle expect.any(), type assertions, etc.
        const ind = '    '.repeat(indent)

        if (typeof obj !== 'object' || obj === null) {
            return JSON.stringify(obj)
        }

        if (Array.isArray(obj)) {
            return `[${obj.map(v => this.objectToTypeScript(v, indent)).join(', ')}]`
        }

        const lines: string[] = ['{']

        for (const [key, value] of Object.entries(obj)) {
            lines.push(`${ind}    ${key}: ${this.objectToTypeScript(value, indent + 1)},`)
        }

        lines.push(`${ind}}`)

        return lines.join('\n')
    }

    private async evaluateSnapshotObject(node: any): Promise<any> {
        // Evaluate TypeScript AST node to runtime value
        // This needs to handle:
        // - expect.any(String) -> keep as-is
        // - Type assertions (as Type) -> strip
        // - satisfies -> strip
        // - Regular values -> evaluate

        // TODO: Implement AST evaluation
        // This is complex - may need to actually import and execute the module
        throw new Error('Not implemented')
    }
}
```

### 2. SNAPSHOTS() Helper

```typescript
// packages/test/src/snapshot/snapshots.ts

/**
 * Type-safe snapshot definition helper.
 * This is a no-op at runtime but provides type inference.
 */
export function SNAPSHOTS<T extends Record<string, any>>(snapshots: T): T {
    return snapshots
}
```

### 3. Inline Snapshot Support

For inline snapshots, we need to extend Vitest's existing `toMatchInlineSnapshot` to support TypeScript objects instead of strings:

```typescript
// packages/test/src/snapshot/inline.ts
import { expect } from 'vitest'
import type { MatcherState } from 'vitest'

declare module 'vitest' {
    interface Assertion<T = any> {
        toMatchInlineSnapshot<TType = T>(snapshot?: Partial<TType>): void
    }
}

// Override Vitest's inline snapshot to support TypeScript objects
expect.extend({
    toMatchInlineSnapshot(received: any, snapshot?: any) {
        const context = this as MatcherState

        // If updating snapshots, modify the test file to insert TypeScript object
        if (context.snapshotState._updateSnapshot === 'all') {
            // Use ts-morph to update the test file
            // Insert object literal as parameter to toMatchInlineSnapshot
            return { pass: true, message: () => 'Snapshot updated' }
        }

        // Compare received with snapshot
        if (!snapshot) {
            return {
                pass: false,
                message: () => 'No snapshot provided. Run with -u to create.'
            }
        }

        // Use toMatchObject for comparison (handles expect.any(), etc.)
        return expect(received).toMatchObject(snapshot)
    }
})
```

## Configuration

### Vitest Config

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        snapshotEnvironment: './packages/test/src/snapshot/TypeScriptSnapshotEnvironment.ts',
        snapshotFormat: {
            // These won't be used since we control the format
            printBasicPrototype: false,
        }
    }
})
```

### Package Dependencies

```json
{
    "dependencies": {
        "ts-morph": "^21.0.0"
    }
}
```

## Workflow

### Creating Snapshots

1. Write test with `expect(value).toMatchSnapshot()`
2. Run `vitest -u` to create snapshot
3. Vitest calls `saveSnapshotFile()` with serialized data
4. TypeScriptSnapshotEnvironment generates `.snapshot.ts` file
5. File is valid TypeScript with imports and type annotations

### Updating Snapshots

1. Test fails due to changed data
2. Run `vitest -u` to update
3. TypeScriptSnapshotEnvironment reads existing `.snapshot.ts`
4. Merges new snapshot data with existing
5. Preserves type annotations, `expect.any()` calls, imports

### Running Tests

1. Test runs `expect(value).toMatchSnapshot()`
2. Vitest calls `readSnapshotFile()`
3. TypeScriptSnapshotEnvironment parses `.snapshot.ts` file
4. Converts TypeScript to runtime objects
5. Comparison uses `toMatchObject()` logic (supports `expect.any()`)

## Challenges & Solutions

### Challenge 1: TypeScript to Runtime Conversion

**Problem**: Need to convert `expect.any(String)` from TypeScript AST to actual runtime matcher.

**Solution**:
- During read, detect `expect.any()` calls in AST
- Convert to actual `expect.any()` runtime objects
- May need to use `vm.runInContext()` to safely evaluate expressions

### Challenge 2: Type Inference

**Problem**: Need to detect types for `satisfies` clauses and imports.

**Solution**:
- Analyze the actual received value during `-u`
- Detect imported types used in test file
- Add necessary imports to snapshot file
- Use TypeScript compiler API for type checking

### Challenge 3: Inline Snapshot Updates

**Problem**: Modifying test files programmatically is risky.

**Solution**:
- Use ts-morph to parse test file
- Find exact location of `toMatchInlineSnapshot()` call
- Insert/update object literal argument
- Preserve formatting and comments

### Challenge 4: expect.any() Serialization

**Problem**: `expect.any()` is a runtime construct, not serializable.

**Solution**:
- Detect patterns in actual values (UUID, timestamps, etc.)
- Auto-suggest `expect.any(String)` for varying strings
- Store metadata in snapshot file comments
- Allow manual annotation

## Type Safety

Snapshot files are fully type-checked:

```typescript
import { LoginResponse } from "../src/api/UserApi.api"

export const snapshots = SNAPSHOTS({
    test1: {
        snap1: {
            // Type error if property doesn't exist on LoginResponse!
            token: "abc",
            user: {
                id: "123",
                // Type error if wrong type!
                username: 123, // ❌ should be string
            }
        } satisfies LoginResponse
    }
})
```

## Benefits

1. **Full Type Safety**: Snapshots are type-checked at compile time
2. **IDE Support**: Autocomplete, go-to-definition, refactoring all work
3. **Vitest Integration**: Standard `-u` workflow, snapshot diffing
4. **Flexible Matching**: Support `expect.any()`, custom matchers
5. **Valid TypeScript**: Can import types, use type assertions
6. **Refactoring**: Renaming types updates snapshots via IDE
7. **Documentation**: Snapshots serve as type-safe documentation

## Limitations

1. **Complexity**: More complex than text-based snapshots
2. **Performance**: TypeScript parsing adds overhead
3. **AST Manipulation**: Modifying code is inherently risky
4. **Type Inference**: Auto-detecting types is difficult

## Future Enhancements

1. **Auto Type Detection**: Automatically infer `satisfies` types
2. **Smart Matchers**: Auto-detect IDs/timestamps and suggest `expect.any()`
3. **Snapshot Diffing**: Better diffs for TypeScript objects
4. **Multi-file Snapshots**: Split large snapshot files automatically
5. **Snapshot Validation**: Ensure snapshots compile in CI
