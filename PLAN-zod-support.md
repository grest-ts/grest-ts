# Plan: Add Zod Schema Support

## Goal

Allow users to use Zod schemas when defining grest-ts contracts via a thin `@grest-ts/schema-zod` wrapper package.

Users who use Zod accept they lose: AOT compilation, compiled serialization, file/multipart support.
They keep: full contract type safety, typed errors, HTTP layer, testing, mocking.

## Background

`GGContractMethod` currently requires `GGSchema<T>` for `input` and `success` fields. The framework internals only call a small subset of `GGSchema` methods. We introduce a `GGSchemaLike<T>` interface capturing that subset, widen the core types to accept it, then provide `fromZod()` that wraps any Zod schema into a `GGSchemaLike`.

---

## Phase 1: Add `GGSchemaLike<T>` interface

**File:** `packages/schema/schema/src/GGSchema.ts`

Insert after the `GGValidator<Type>` interface (after line 25), before the `Brand` type:

```typescript
export interface GGSchemaLike<Type> extends GGValidator<Type> {
    readonly infer: Type;
    unsafeStringify?(value: Type): string | undefined;
}
```

This extends `GGValidator` which already has `is`, `assert`, `parse`, `safeParse`. Adds:
- `infer` — type-level property for type extraction (existing inference patterns use structural `{ infer: infer T }` so this just works)
- `unsafeStringify` — optional, callers fall back to `JSON.stringify` when absent

`GGSchema<T>` already satisfies this interface. No changes to `GGSchema` class needed.

The interface is already exported via `export * from "./GGSchema"` in `packages/schema/schema/src/index-node.ts`.

---

## Phase 2: Widen type signatures in core files

### 2a. `packages/schema/schema/src/contract/GGContractClass.ts`

Add `GGSchemaLike` to import on line 3:
```typescript
import {GGSchema, GGSchemaLike} from "../GGSchema";
```

Change `GGContractMethod` (lines 7-11):
```typescript
export interface GGContractMethod<Request = any, Response = any, ErrorsUnion extends ANY_ERROR_CLS = any> {
    input?: GGSchemaLike<Request>
    success?: GGSchemaLike<Response>;
    errors?: ErrorsUnion[];
}
```

The type inference types (`GGContractImplementationMethod`, `GGContractClientMethod`, etc.) already use structural `{ infer: infer T }` pattern — no changes needed there.

### 2b. `packages/schema/schema/src/contract/GGContractExecutor.ts`

Change import on line 2:
```typescript
import {GGSchemaLike} from "../GGSchema";
```
(Remove `GGSchema` from import if no longer used directly.)

Widen all `GGSchema<T>` parameter/return types to `GGSchemaLike<T>`:
- Line 24: `parseInput` — `schema: GGSchemaLike<RequestData> | undefined`
- Line 45: `getResponseSchema` return type — `GGSchemaLike<...> | undefined`
- Line 88: `parseOutputData` — `schema: GGSchemaLike<DataOrError> | undefined`
- Line 137: `assertResponse` — `schema: GGSchemaLike<DataOrError> | undefined`

Method bodies only call `.safeParse()` and `.is()` which are both on `GGSchemaLike`. No body changes needed.

### 2c. `packages/schema/schema/src/contract/ERROR.ts`

Change import on line 1:
```typescript
import {GGSchema, GGSchemaLike} from "../GGSchema";
```

Widen `ERROR_CLASS` interface (line 44):
```typescript
readonly schema?: GGSchemaLike<Data> | undefined
```

Widen `ERROR.define()` overloads (lines 105-107):
```typescript
public static define<Type extends string>(type: Type, statusCode: number): ERR_CLASS<Type>
public static define<Type extends string, Data>(type: Type, statusCode: number, schema: GGSchemaLike<Data>): ERR_CLASS_DATA<Type, Data>
public static define(type: string, statusCode: number, schema?: GGSchemaLike<any>): any {
```

Widen `ERROR.badRequest()` overloads (lines 151-153):
```typescript
public static badRequest<Type extends string, Data = never>(type: Type): ERR_CLASS<Type>
public static badRequest<Type extends string, Data>(type: Type, schema: GGSchemaLike<Data>): ERR_CLASS_DATA<Type, Data>
public static badRequest(type: string, schema?: GGSchemaLike<any>): any {
```

Also widen `static readonly schema = schema` inside the `define` implementation (line 119). The runtime assignment doesn't change — it's just that the static type on `ERROR_CLASS` is now `GGSchemaLike`.

### 2d. `packages/http/http/src/rpc/RpcResponse/GGRpcResponseBuilder.ts`

Change import on line 2 to include `GGSchemaLike`:
```typescript
import {ANY_ERROR, ERROR, GGContractExecutor, GGContractMethod, GGDebugData, GGErrorData, GGSchemaLike, OK} from "@grest-ts/schema";
```
(Remove `GGSchema` from import.)

Change `makeError` parameter type (line 35):
```typescript
private makeError(schema: GGSchemaLike<any> | undefined, rpcResult: ERROR<string, unknown>) {
```

Change `makeDataStr` method (line 45) to handle optional `unsafeStringify`:
```typescript
private makeDataStr(schema: GGSchemaLike<any> | undefined, data: OK<any> | ANY_ERROR): string {
    if (schema) {
        GGContractExecutor.assertResponse(schema, data);
        const dataStr = schema.unsafeStringify
            ? schema.unsafeStringify(data.data)
            : JSON.stringify(data.data);
        return dataStr ? ',"data":' + dataStr + "" : "";
    } else {
        return "";
    }
}
```

### 2e. Verify

Run existing test suite to confirm zero breaking changes.

---

## Phase 3: Create `@grest-ts/schema-zod` package

**Directory:** `packages/schema/schema-zod/`

This is already covered by the `"packages/schema/*"` workspace glob in root `package.json`.

### 3a. Package boilerplate

**`packages/schema/schema-zod/grest.package.ts`:**
```typescript
import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/schema-zod",
    description: "Zod schema adapter for grest-ts contracts",
    publishToNpm: true,
    keywords: ["zod", "schema", "adapter", "validation"],
    targets: {node: true, browser: true},
    peerDependencies: {
        "zod": "^3.0.0"
    }
})
```

Note: Check other `grest.package.ts` files for how `peerDependencies` are specified. It may use a different field name. Adapt accordingly.

**`packages/schema/schema-zod/src/tsconfig.json`:** (follows same pattern as config-aws)
```json
{
  "extends": "../../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["**/*"]
}
```

**`packages/schema/schema-zod/src/index.ts`:**
```typescript
export {fromZod} from "./fromZod";
export type {ZodSchemaLike} from "./fromZod";
```

### 3b. Core wrapper

**`packages/schema/schema-zod/src/fromZod.ts`:**

```typescript
import type {z} from "zod";
import type {GGSchemaLike, GGParseResult} from "@grest-ts/schema";
import {GGIssuesList, GGIssueKey} from "@grest-ts/schema";

const ZOD_ISSUE = new GGIssueKey<{message: string}>("zod_validation", "{message}", {message: "Validation message from Zod"});

export type ZodSchemaLike<T extends z.ZodType> = GGSchemaLike<z.infer<T>>;

export function fromZod<T extends z.ZodType>(zodSchema: T): GGSchemaLike<z.infer<T>> {
    type Out = z.infer<T>;

    const wrapper: GGSchemaLike<Out> = {

        get infer(): Out {
            throw new Error("infer is a type-only property and should not be called at runtime");
        },

        safeParse(value: unknown, _coerce?: boolean): GGParseResult<Out> {
            const result = zodSchema.safeParse(value);
            if (result.success) {
                return {success: true, value: result.data};
            }
            return {success: false, issues: mapZodErrors(result.error)};
        },

        parse(value: unknown, coerce?: boolean): Out {
            const result = wrapper.safeParse(value, coerce);
            if (result.success) return result.value;
            throw result.issues;
        },

        is(value: unknown): value is Out {
            return zodSchema.safeParse(value).success;
        },

        assert(value: unknown): asserts value is Out {
            const result = zodSchema.safeParse(value);
            if (!result.success) {
                throw mapZodErrors(result.error);
            }
        },

        unsafeStringify(value: Out): string | undefined {
            const result = zodSchema.safeParse(value);
            if (!result.success) return undefined;
            return JSON.stringify(result.data);
        }
    };

    return wrapper;
}

function mapZodErrors(error: z.ZodError): GGIssuesList {
    const issues = new GGIssuesList();
    for (const issue of error.issues) {
        const path = issue.path.join(".");
        ZOD_ISSUE.add(issue, issues, path, {message: issue.message});
    }
    return issues;
}
```

**Design notes:**
- `coerce` parameter is prefixed with `_` and ignored. Zod coercion is schema-level (`z.coerce.number()`), not call-site. This is a documented behavioral difference.
- `unsafeStringify` does `safeParse` + `JSON.stringify` — slower than GGSchema's compiled serialization but functionally correct.
- `GGIssueKey` constructor with `<{message: string}>` typed params enables `{message}` template interpolation so the Zod error message appears in `GGIssuesList.getMessage()`.
- `GGIssuesList` is constructed from the real class with `.add()` calls — matches framework expectations.
- `mapZodErrors` passes the full Zod issue object as `value` to `.add()`, so it's accessible via `GGIssuesList.getValue()`.

### 3c. Tests

**`packages/schema/schema-zod/src/fromZod.test.ts`:**

Test the following:
1. **Basic string** — `fromZod(z.string())`: test `parse`, `safeParse`, `is`, `assert` with valid and invalid values
2. **Object with error paths** — `fromZod(z.object({name: z.string(), age: z.number()}))`: verify error paths are dot-separated (e.g. `"age"`)
3. **Nested object paths** — verify `"address.street"` style paths
4. **`unsafeStringify`** — returns valid JSON string for valid data, `undefined` for invalid
5. **Error format** — `safeParse` failure returns `GGIssuesList` with correct `.length`, `.toJSON()` returns `ValidationIssueJson[]` with `path`, `code`, `message`
6. **`is()` type guard** — returns `true`/`false` without throwing
7. **`assert()` throws** — throws `GGIssuesList` on invalid input
8. **Contract integration** — define a `GGContractClass` with `input: fromZod(z.object(...))`, call `.implement()`, verify execution works
9. **ERROR.define with Zod** — `ERROR.define("MY_ERR", 400, fromZod(z.object({field: z.string()})))` works
10. **Type inference** — compile-time test: verify `typeof wrapper.infer` matches `z.infer<typeof zodSchema>`

---

## Phase 4: Install zod as dev dependency

Run `npm install zod --save-dev` at the workspace root (or as peer in the schema-zod package). Zod is a `peerDependency` for end users but needed in the repo for tests.

---

## Verification checklist

1. Existing test suite passes — no regressions from type widening
2. TypeScript compiles cleanly across all packages
3. New `schema-zod` tests pass
4. Type inference: a contract defined with `fromZod(z.object({id: z.string()}))` correctly infers `{id: string}` in implementation and client types

---

## Files modified (summary)

| File | Change |
|------|--------|
| `packages/schema/schema/src/GGSchema.ts` | Add `GGSchemaLike<T>` interface after line 25 |
| `packages/schema/schema/src/contract/GGContractClass.ts` | Widen `GGContractMethod` to use `GGSchemaLike` |
| `packages/schema/schema/src/contract/GGContractExecutor.ts` | Widen parameter types to `GGSchemaLike` |
| `packages/schema/schema/src/contract/ERROR.ts` | Widen `define()`, `badRequest()`, `ERROR_CLASS.schema` |
| `packages/http/http/src/rpc/RpcResponse/GGRpcResponseBuilder.ts` | Fallback for optional `unsafeStringify` |

## Files created

| File | Purpose |
|------|---------|
| `packages/schema/schema-zod/grest.package.ts` | Package definition |
| `packages/schema/schema-zod/src/tsconfig.json` | TypeScript config |
| `packages/schema/schema-zod/src/index.ts` | Exports |
| `packages/schema/schema-zod/src/fromZod.ts` | Core wrapper (~60 lines) |
| `packages/schema/schema-zod/src/fromZod.test.ts` | Tests |
