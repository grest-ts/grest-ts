# SPEC: TypeScript Snapshots via Custom Matcher

## Overview

Implement TypeScript-based snapshot testing using a custom Vitest matcher (`toMatchTsSnapshot`). This approach provides type-safe snapshot files without modifying Vitest's core snapshot infrastructure, making it simpler to implement but less integrated with Vitest's native features.

## Goals

1. **Type-Safe Snapshots**: Snapshot files are valid TypeScript that compile and type-check
2. **IDE Integration**: Full autocomplete, refactoring, and navigation support
3. **Type References**: Link to actual interface definitions from the codebase
4. **Dynamic Matchers**: Support `expect.any(String)`, `expect.any(Number)`, custom matchers
5. **Simple Integration**: Works alongside Vitest without replacing core infrastructure
6. **Two Modes**: Support both inline snapshots and separate `.snapshot.ts` files
7. **Valid TypeScript**: All snapshot files must compile without errors

## Architecture

### File Structure

```
test/
├── exampleTest1.test.ts          # Test file
├── exampleTest1.snapshot.ts      # External snapshots (created manually or via -u)
└── __snapshots__/                # Standard Vitest snapshots (if also using toMatchSnapshot)
```

### Snapshot File Format

External snapshots (`.snapshot.ts`):

```typescript
import { SNAPSHOTS } from "@grest-ts/test"
import { LoginResponse } from "../src/api/UserApi.api"
import { tUserAuthToken } from "../src/api/types"

export const exampleTest1Snapshots = SNAPSHOTS({
    userRegistration: {
        successCase: {
            token: "" as tUserAuthToken,
            user: {
                id: expect.any(String),
                username: "alice",
                email: "alice@example.com",
            }
        } satisfies LoginResponse,

        errorCase: {
            error: "Invalid credentials",
            status: 401
        }
    }
})
```

Inline snapshots (in test file):

```typescript
test("user registration", async () => {
    const result = await alice.userPublic.register(aliceData)

    // Inline snapshot - object defined directly in test
    await expect(result).toMatchTsInlineSnapshot<LoginResponse>({
        token: expect.any(String),
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
import { exampleTest1Snapshots } from './exampleTest1.snapshot'

describe("User API", () => {
    test("user registration", async () => {
        const result = await alice.userPublic.register(aliceData)

        // Direct reference to snapshot
        await expect(result).toMatchTsSnapshot(
            exampleTest1Snapshots.userRegistration.successCase
        )
    })

    test("multiple snapshots", async () => {
        const register = await alice.userPublic.register(aliceData)
        await expect(register).toMatchTsSnapshot(
            exampleTest1Snapshots.userRegistration.successCase
        )

        const login = await alice.userPublic.login(loginData)
        await expect(login).toMatchTsSnapshot(
            exampleTest1Snapshots.userLogin.successCase
        )
    })
})
```

### Inline Snapshots

```typescript
test("user registration", async () => {
    const result = await alice.userPublic.register(aliceData)

    // Type parameter provides autocomplete and type checking
    await expect(result).toMatchTsInlineSnapshot<LoginResponse>({
        token: expect.any(String),
        user: {
            id: expect.any(String),
            username: "alice",
            email: "alice@example.com",
        }
    })
})
```

### Auto-Update Mode

```typescript
import { exampleTest1Snapshots } from './exampleTest1.snapshot'

test("user registration", async () => {
    const result = await alice.userPublic.register(aliceData)

    // When UPDATE_SNAPSHOTS=true, this creates/updates the snapshot file
    await expect(result).toMatchTsSnapshot(
        exampleTest1Snapshots.userRegistration.successCase,
        {
            // Snapshot path and key are inferred from import
            __snapshotPath: './exampleTest1.snapshot.ts',
            __snapshotKey: 'userRegistration.successCase'
        }
    )
})
```

## Implementation Components

### 1. Custom Matcher - toMatchTsSnapshot

```typescript
// packages/test/src/matchers/toMatchTsSnapshot.ts
import { expect } from 'vitest'
import type { MatcherState } from 'vitest'

declare module 'vitest' {
    interface Assertion<T = any> {
        toMatchTsSnapshot(snapshot: T, options?: SnapshotOptions): Promise<void>
    }
}

interface SnapshotOptions {
    __snapshotPath?: string
    __snapshotKey?: string
}

export function setupTsSnapshotMatcher() {
    expect.extend({
        async toMatchTsSnapshot(received: any, snapshot: any, options?: SnapshotOptions) {
            const context = this as MatcherState
            const shouldUpdate = process.env.UPDATE_SNAPSHOTS === 'true'

            if (shouldUpdate && options?.__snapshotPath && options?.__snapshotKey) {
                // Update the snapshot file
                await updateSnapshotFile(
                    options.__snapshotPath,
                    options.__snapshotKey,
                    received
                )
            }

            // Compare using toMatchObject (handles expect.any())
            const matcher = expect(received).toMatchObject(snapshot)

            if (matcher.pass) {
                return {
                    pass: true,
                    message: () => 'Snapshot matched'
                }
            } else {
                return {
                    pass: false,
                    message: () => `Snapshot did not match:\n${matcher.message}`
                }
            }
        }
    })
}

async function updateSnapshotFile(
    filePath: string,
    key: string,
    value: any
): Promise<void> {
    const { Project } = await import('ts-morph')

    const project = new Project()
    const sourceFile = project.addSourceFileAtPath(filePath)

    // Find the SNAPSHOTS call
    const snapshotExport = sourceFile.getVariableDeclaration(
        (decl) => decl.getInitializer()?.getText().startsWith('SNAPSHOTS')
    )

    if (!snapshotExport) {
        throw new Error(`No SNAPSHOTS export found in ${filePath}`)
    }

    // Parse the snapshot key (e.g., "userRegistration.successCase")
    const keys = key.split('.')

    // Navigate to the correct nested object
    const initializer = snapshotExport.getInitializer()
    const snapshotCall = initializer.asKind(SyntaxKind.CallExpression)
    const snapshotObject = snapshotCall.getArguments()[0].asKind(SyntaxKind.ObjectLiteralExpression)

    let currentObject = snapshotObject

    for (let i = 0; i < keys.length - 1; i++) {
        const property = currentObject.getProperty(keys[i])
        if (property) {
            currentObject = property.getInitializer().asKind(SyntaxKind.ObjectLiteralExpression)
        } else {
            // Create nested structure
            currentObject.addPropertyAssignment({
                name: keys[i],
                initializer: '{}'
            })
            currentObject = currentObject.getProperty(keys[i])
                .getInitializer()
                .asKind(SyntaxKind.ObjectLiteralExpression)
        }
    }

    // Update or create the final property
    const finalKey = keys[keys.length - 1]
    const existingProperty = currentObject.getProperty(finalKey)

    const newValue = valueToTypeScript(value)

    if (existingProperty) {
        existingProperty.set({ initializer: newValue })
    } else {
        currentObject.addPropertyAssignment({
            name: finalKey,
            initializer: newValue
        })
    }

    await sourceFile.save()
}

function valueToTypeScript(value: any, indent = 0): string {
    const ind = '    '.repeat(indent)

    if (value === null) return 'null'
    if (value === undefined) return 'undefined'

    if (typeof value === 'string') return `"${value}"`
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return String(value)

    if (Array.isArray(value)) {
        const items = value.map(v => valueToTypeScript(v, indent + 1))
        return `[\n${ind}    ${items.join(`,\n${ind}    `)}\n${ind}]`
    }

    if (typeof value === 'object') {
        const lines: string[] = ['{']

        for (const [key, val] of Object.entries(value)) {
            // Detect patterns that should use expect.any()
            if (shouldUseExpectAny(key, val)) {
                lines.push(`${ind}    ${key}: expect.any(${getExpectAnyType(val)}),`)
            } else {
                lines.push(`${ind}    ${key}: ${valueToTypeScript(val, indent + 1)},`)
            }
        }

        lines.push(`${ind}}`)
        return lines.join('\n')
    }

    return String(value)
}

function shouldUseExpectAny(key: string, value: any): boolean {
    // Heuristics for detecting dynamic values
    if (key === 'id' && typeof value === 'string') return true
    if (key === 'token' && typeof value === 'string') return true
    if (key === 'createdAt' && typeof value === 'string') return true
    if (key === 'updatedAt' && typeof value === 'string') return true
    if (key.endsWith('Id') && typeof value === 'string') return true

    return false
}

function getExpectAnyType(value: any): string {
    if (typeof value === 'string') return 'String'
    if (typeof value === 'number') return 'Number'
    if (typeof value === 'boolean') return 'Boolean'
    return 'Object'
}
```

### 2. Custom Matcher - toMatchTsInlineSnapshot

```typescript
// packages/test/src/matchers/toMatchTsInlineSnapshot.ts
import { expect } from 'vitest'
import type { MatcherState } from 'vitest'

declare module 'vitest' {
    interface Assertion<T = any> {
        toMatchTsInlineSnapshot<TType = T>(snapshot?: Partial<TType>): Promise<void>
    }
}

export function setupTsInlineSnapshotMatcher() {
    expect.extend({
        async toMatchTsInlineSnapshot(received: any, snapshot?: any) {
            const context = this as MatcherState
            const shouldUpdate = process.env.UPDATE_SNAPSHOTS === 'true'

            if (shouldUpdate && !snapshot) {
                // Update the test file to add inline snapshot
                await updateInlineSnapshot(context, received)
                return {
                    pass: true,
                    message: () => 'Inline snapshot created'
                }
            }

            if (!snapshot) {
                return {
                    pass: false,
                    message: () => 'No snapshot provided. Run with UPDATE_SNAPSHOTS=true to create.'
                }
            }

            // Compare using toMatchObject
            const matcher = expect(received).toMatchObject(snapshot)

            return {
                pass: matcher.pass,
                message: () => matcher.message
            }
        }
    })
}

async function updateInlineSnapshot(
    context: MatcherState,
    value: any
): Promise<void> {
    const { Project } = await import('ts-morph')

    // Get test file path from context
    const testFilePath = context.testPath

    const project = new Project()
    const sourceFile = project.addSourceFileAtPath(testFilePath)

    // Find the toMatchTsInlineSnapshot call at the current line
    // This is tricky - we need to use stack traces or other means
    // to locate the exact call site

    // For now, assume we can get line/column from context
    const callExpression = findCallExpressionAtLocation(
        sourceFile,
        context.currentTestName,
        'toMatchTsInlineSnapshot'
    )

    if (!callExpression) {
        throw new Error('Could not find toMatchTsInlineSnapshot call')
    }

    // Generate TypeScript object literal
    const snapshotCode = valueToTypeScript(value)

    // Update the call to include the snapshot
    if (callExpression.getArguments().length === 0) {
        callExpression.addArgument(snapshotCode)
    } else {
        callExpression.getArguments()[0].replaceWithText(snapshotCode)
    }

    await sourceFile.save()
}

function findCallExpressionAtLocation(
    sourceFile: SourceFile,
    testName: string,
    methodName: string
): CallExpression | undefined {
    // Find test() or it() call with matching name
    const testCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter(call => {
            const expr = call.getExpression()
            return (expr.getText() === 'test' || expr.getText() === 'it') &&
                   call.getArguments()[0]?.getText().includes(testName)
        })

    // Within test, find toMatchTsInlineSnapshot call
    for (const testCall of testCalls) {
        const callExpression = testCall.getDescendantsOfKind(SyntaxKind.CallExpression)
            .find(call => call.getExpression().getText().includes(methodName))

        if (callExpression) {
            return callExpression
        }
    }

    return undefined
}
```

### 3. SNAPSHOTS() Helper

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

### 4. Setup File

```typescript
// packages/test/src/setup.ts
import { setupTsSnapshotMatcher } from './matchers/toMatchTsSnapshot'
import { setupTsInlineSnapshotMatcher } from './matchers/toMatchTsInlineSnapshot'

// Auto-setup matchers
setupTsSnapshotMatcher()
setupTsInlineSnapshotMatcher()

export { SNAPSHOTS } from './snapshot/snapshots'
```

## Configuration

### Vitest Config

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        setupFiles: ['@grest-ts/test/setup'],
        // Use environment variable instead of -u flag
        // UPDATE_SNAPSHOTS=true vitest
    }
})
```

### Package.json Scripts

```json
{
    "scripts": {
        "test": "vitest",
        "test:update-snapshots": "UPDATE_SNAPSHOTS=true vitest run"
    }
}
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

1. Write test with `expect(value).toMatchTsSnapshot(snapshot)`
2. Create `.snapshot.ts` file manually with empty/partial snapshot
3. Run `UPDATE_SNAPSHOTS=true vitest` to fill in values
4. Matcher updates the snapshot file programmatically

**OR**

1. Write test with `expect(value).toMatchTsInlineSnapshot<Type>()`
2. Run `UPDATE_SNAPSHOTS=true vitest` to create inline snapshot
3. Matcher modifies test file to insert object literal

### Updating Snapshots

1. Test fails due to changed data
2. Run `UPDATE_SNAPSHOTS=true vitest` to update
3. Matcher reads existing snapshot file
4. Updates specific snapshot value
5. Preserves imports, type annotations, and other snapshots

### Running Tests

1. Test runs `expect(value).toMatchTsSnapshot(snapshot)`
2. Matcher compares using `toMatchObject()`
3. Supports `expect.any()`, partial matching, nested objects
4. Reports diff if mismatch

## Challenges & Solutions

### Challenge 1: Finding Call Site for Inline Snapshots

**Problem**: Need to locate the exact `toMatchTsInlineSnapshot()` call in the test file.

**Solution**:
- Use test name to narrow down location
- Search AST for matching call expression
- Use line numbers from stack trace if available
- Fall back to manual annotation: `// @snapshot`

### Challenge 2: No Native -u Flag Support

**Problem**: Can't use `vitest -u` like standard snapshots.

**Solution**:
- Use environment variable: `UPDATE_SNAPSHOTS=true`
- Provide npm script: `npm run test:update-snapshots`
- Less convenient but explicit

### Challenge 3: Snapshot Path/Key Tracking

**Problem**: Matcher needs to know where to update snapshots.

**Solution**:
- Require explicit snapshot references (good for clarity)
- OR use metadata in options parameter
- OR use Babel plugin to inject metadata at compile time

### Challenge 4: TypeScript Formatting

**Problem**: Generated code may not match project style.

**Solution**:
- Use ts-morph which preserves formatting
- Add Prettier pass after generation
- Allow manual formatting (snapshot files are code)

## Type Safety

Snapshot files are fully type-checked:

```typescript
import { LoginResponse } from "../src/api/UserApi.api"

export const snapshots = SNAPSHOTS({
    registration: {
        // Type error if property doesn't exist!
        token: "abc",
        user: {
            id: "123",
            username: "alice",
            // Type error if wrong type!
            age: "25" // ❌ should be number if LoginResponse.user.age is number
        }
    } satisfies LoginResponse
})
```

Tests are also type-checked:

```typescript
await expect(result).toMatchTsInlineSnapshot<LoginResponse>({
    token: expect.any(String),
    user: {
        invalidProp: "value" // ❌ Type error!
    }
})
```

## Benefits

1. **Simpler Implementation**: No need to replace Vitest core infrastructure
2. **Type Safety**: Full TypeScript compilation and type checking
3. **IDE Support**: Autocomplete, navigation, refactoring all work
4. **Explicit Snapshots**: Clear reference to snapshot location
5. **Valid TypeScript**: Can import types, use type assertions
6. **Gradual Adoption**: Can use alongside standard Vitest snapshots
7. **Flexible**: Easy to extend with custom logic

## Limitations

1. **No -u Flag**: Must use environment variable instead
2. **Manual Snapshot Creation**: Need to create `.snapshot.ts` files manually (or use update mode)
3. **Less Integrated**: Doesn't appear in Vitest's snapshot UI
4. **Explicit References**: Must import and reference snapshots explicitly
5. **File Modification Risk**: Programmatic AST updates can be fragile
6. **Performance**: ts-morph adds overhead

## Comparison with Option 1

| Feature | Option 1 (SnapshotEnvironment) | Option 2 (Custom Matcher) |
|---------|--------------------------------|---------------------------|
| `-u` flag support | ✅ Yes | ❌ No (use env var) |
| Vitest integration | ✅ Full | ⚠️ Partial |
| Implementation complexity | ⚠️ High | ✅ Low |
| Type safety | ✅ Full | ✅ Full |
| IDE support | ✅ Full | ✅ Full |
| Explicit references | ❌ Auto-generated | ✅ Explicit |
| Gradual adoption | ❌ All-or-nothing | ✅ Side-by-side |
| Snapshot UI | ✅ Yes | ❌ No |
| Risk level | ⚠️ High (core infra) | ✅ Low (just matchers) |

## Recommendation

**Use Option 2 if:**
- You want simpler implementation and lower risk
- You prefer explicit snapshot references (more readable)
- You can live with `UPDATE_SNAPSHOTS=true` instead of `-u`
- You want to gradually adopt TypeScript snapshots

**Use Option 1 if:**
- You want full Vitest integration
- You prefer automatic snapshot management
- You want to use `-u` flag
- You're comfortable with complex implementation

## Future Enhancements

1. **Babel Plugin**: Inject snapshot metadata at compile time
2. **CLI Tool**: `gg-test update-snapshots` command
3. **Watch Mode**: Auto-update snapshots in watch mode with prompt
4. **Diff UI**: Better diffs for TypeScript objects
5. **Auto Import**: Automatically add type imports to snapshot files
6. **Smart Matchers**: Auto-detect dynamic values and suggest `expect.any()`
