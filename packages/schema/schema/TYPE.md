# @grest-ts/schema - Type Validation System

A TypeScript-first validation library with AOT compilation support, inspired by Zod/TypeBox but with custom semantics optimized for performance and memory efficiency.

## Design Principles

1. **Chainable constraints** - Validators like `IsString` can be chained: `.minLength()`, `.maxLength()`, `.regex()`, etc.
2. **Final validators** - Some validators are "final" and cannot be further constrained (e.g., `IsEmail`, branded types)
3. **Universal modifiers** - All validators have `.orUndefined` and `.orNull`
4. **Brand finalization** - Calling `.brand()` finalizes a type - no further constraints allowed
5. **Brand uniqueness** - Each brand name can only be registered once (throws on duplicate)
6. **Memory efficiency** - Common patterns are cached (e.g., `IsString.orUndefined`)
7. **Runtime introspection** - All validators expose a `.def` for JSON Schema generation, etc.
8. **Error aggregation** - Uses `GGIssuesList` for efficient error collection

---

## Validator Categories

### 1. Chainable Validators

These allow constraint methods and return the same type for chaining:

| Validator | Constraints | Example |
|-----------|-------------|---------|
| `IsString` | `minLength`, `maxLength`, `range`, `regex`, `nonEmpty` | `IsString.minLength(1).maxLength(100)` |
| `IsNumber` | `min`, `max`, `range`, `positive`, `negative`, `integer` | `IsNumber.min(0).max(100)` |
| `IsBoolean` | (none) | `IsBoolean` |
| `IsObject` | `of`, `extend`, `merge`, `pick`, `omit` | `IsObject.of({...})` |
| `IsArray` | `minLength`, `maxLength` | `IsArray(IsString)` |

### 2. Final Validators

These only have universal modifiers (`.orUndefined`, `.orNull`):

| Validator | Description |
|-----------|-------------|
| `IsEmail` | Email format validation |
| `IsUrl` | URL format validation |
| `IsUuid` | UUID format validation |
| `IsLatitude` | Latitude range (-90 to 90) |
| `IsLongitude` | Longitude range (-180 to 180) |
| `IsInt` | Integer number |
| `IsUint` | Unsigned integer (>= 0) |
| Branded types | Created via `.brand()` |
| `IsUnion(...)` | Union of validators |
| `IsLiteral(...)` | Literal values |

---

## API Reference

### Base Validator Interface

```typescript
interface Validator<T> {
    readonly def: ValidatorDef;

    is(value: unknown): value is T;
    parse(value: unknown, issues: GGIssuesList, path: string, coerce?: boolean): T | undefined;
    assert(value: unknown): asserts value is T;

    get orUndefined(): Validator<T | undefined>;
    get orNull(): Validator<T | null>;

    get infer(): T; // Type helper, never called at runtime
}
```

### StringSchema (Chainable)

```typescript
class StringSchema<T extends string | undefined | null = string> {
    readonly def: StringDef;

    // Universal modifiers
    get orUndefined(): StringSchema<T | undefined>;
    get orNull(): StringSchema<T | null>;

    // Constraints (return StringSchema for chaining)
    get nonEmpty(): StringSchema<T>;
    minLength(n: number): StringSchema<T>;
    maxLength(n: number): StringSchema<T>;
    range(min: number, max: number): StringSchema<T>;
    regex(pattern: RegExp): StringSchema<T>;

    // Finalizer (returns FinalValidator)
    brand<B extends string>(name: B): FinalValidator<T & Brand<B>>;
}

interface StringDef {
    type: 'string';
    optional?: boolean;
    nullable?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    nonEmpty?: boolean;
}

export const IsString: StringSchema = new StringSchema({ type: 'string' });
```

### NumberSchema (Chainable)

```typescript
class NumberSchema<T extends number | undefined | null = number> {
    readonly def: NumberDef;

    // Universal modifiers
    get orUndefined(): NumberSchema<T | undefined>;
    get orNull(): NumberSchema<T | null>;

    // Constraints
    min(n: number): NumberSchema<T>;
    max(n: number): NumberSchema<T>;
    range(min: number, max: number): NumberSchema<T>;
    get positive(): NumberSchema<T>;
    get negative(): NumberSchema<T>;
    get integer(): NumberSchema<T>;

    // Finalizer
    brand<B extends string>(name: B): FinalValidator<T & Brand<B>>;
}

interface NumberDef {
    type: 'number';
    optional?: boolean;
    nullable?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
}

export const IsNumber: NumberSchema = new NumberSchema({ type: 'number' });
```

### BooleanSchema (Chainable but no constraints)

```typescript
class BooleanSchema<T extends boolean | undefined | null = boolean> {
    readonly def: BooleanDef;

    get orUndefined(): BooleanSchema<T | undefined>;
    get orNull(): BooleanSchema<T | null>;

    // Finalizer
    brand<B extends string>(name: B): FinalValidator<T & Brand<B>>;
}

export const IsBoolean: BooleanSchema = new BooleanSchema({ type: 'boolean' });
```

### ObjectSchema (Chainable)

```typescript
class ObjectSchema<T extends object | undefined | null = object> {
    readonly def: ObjectDef;

    // Universal modifiers
    get orUndefined(): ObjectSchema<T | undefined>;
    get orNull(): ObjectSchema<T | null>;

    // Schema definition
    of<S extends Record<string, Validator<any>>>(
        shape: S | (() => S)  // Factory function for circular refs
    ): ObjectSchema<Infer<S>>;

    // Extensions
    extend<S extends Record<string, Validator<any>>>(shape: S): ObjectSchema<T & Infer<S>>;
    merge<U extends object>(other: ObjectSchema<U>): ObjectSchema<T & U>;
    pick<K extends keyof T>(...keys: K[]): ObjectSchema<Pick<T, K>>;
    omit<K extends keyof T>(...keys: K[]): ObjectSchema<Omit<T, K>>;

    // Discriminated union factory (static)
    static discriminated<D extends string, V extends ObjectSchema<any>[]>(
        discriminator: D,
        variants: V
    ): DiscriminatedUnionSchema;
}

interface ObjectDef {
    type: 'object';
    optional?: boolean;
    nullable?: boolean;
    shape?: Record<string, Validator<any>>;
    shapeFactory?: () => Record<string, Validator<any>>;
}

export const IsObject: ObjectSchema = new ObjectSchema({ type: 'object' });
```

### ArraySchema (Chainable)

```typescript
class ArraySchema<T = unknown[]> {
    readonly def: ArrayDef;

    // Universal modifiers
    get orUndefined(): ArraySchema<T | undefined>;
    get orNull(): ArraySchema<T | null>;

    // Element type
    of<E>(element: Validator<E>): ArraySchema<E[]>;

    // Constraints
    minLength(n: number): ArraySchema<T>;
    maxLength(n: number): ArraySchema<T>;
}

interface ArrayDef {
    type: 'array';
    optional?: boolean;
    nullable?: boolean;
    element?: Validator<any>;
    minLength?: number;
    maxLength?: number;
}

export const IsArray: ArraySchema = new ArraySchema({ type: 'array' });
```

### FinalValidator (Base for finals)

```typescript
class FinalValidator<T> implements Validator<T> {
    readonly def: ValidatorDef;

    // ONLY universal modifiers - no constraints
    get orUndefined(): FinalValidator<T | undefined>;
    get orNull(): FinalValidator<T | null>;

    is(value: unknown): value is T;
    parse(value: unknown, issues: GGIssuesList, path: string, coerce?: boolean): T | undefined;
    assert(value: unknown): asserts value is T;

    get infer(): T;
}
```

### IsUnion (Function)

```typescript
function IsUnion<T extends Validator<any>[]>(
    ...variants: T
): UnionSchema<Infer<T[number]>>;

// Usage
const Status = IsUnion(IsString, IsNumber);
```

### IsLiteral (Function)

```typescript
function IsLiteral<T extends (string | number | boolean)[]>(
    ...values: T
): LiteralSchema<T[number]>;

// Usage
const Status = IsLiteral("active", "inactive", "pending");
```

### Discriminated Union

```typescript
const Vehicle = IsObject.discriminated("type", [
    IsObject.of({ type: IsLiteral("car"), wheels: IsNumber }),
    IsObject.of({ type: IsLiteral("bike"), pedals: IsBoolean }),
]);
```

---

## Branding

### Usage

```typescript
// Create branded type
const IsUserId = IsString.minLength(1).brand("UserId");
type tUserId = typeof IsUserId.infer;  // string & Brand<"UserId">

// Branded type is final - cannot chain further
IsUserId.minLength(5);  // TypeScript error!
IsUserId.orUndefined;   // OK - returns FinalValidator
```

### Brand Registry

```typescript
// Brands must be unique - throws on duplicate
const A = IsString.brand("UserId");
const B = IsNumber.brand("UserId");  // throws: Brand "UserId" already registered
```

### Brand Type Helper

```typescript
type Brand<T extends string> = { readonly __brand: T };
```

---

## Caching Strategy

### Cached (from base validators)

| Expression | Cached |
|------------|--------|
| `IsString.orUndefined` | Yes |
| `IsString.nonEmpty` | Yes |
| `IsString.minLength(10)` | Yes (from IsString) |
| `IsNumber.orUndefined` | Yes |
| `IsArray(IsString)` | Yes (WeakMap by element) |

### Not Cached

| Expression | Reason |
|------------|--------|
| `IsString.minLength(10).orUndefined` | Derived from non-base |
| `IsString.brand("X")` | Brands are unique singletons |
| `IsObject.of({...})` | Each shape is unique |

---

## Validation & Error Handling

### GGIssuesList

Efficient error collection using flat array storage:

```typescript
const issues = new GGIssuesList();
const result = IsString.parse(value, issues, "fieldName");

if (issues.hasIssues()) {
    // Handle errors
    console.log(issues.toJSON());
}
```

### Error Format

```typescript
interface ValidationIssueJson {
    path: string;       // e.g., "user.email"
    code: string;       // e.g., "invalid.string.type"
    message: string;    // Localized message
    usedLanguage: string;
    params?: object;    // e.g., { min: 5, max: 100 }
}
```

### Defining Issues

```typescript
// Simple issue
const typeError = new GGIssueInvalid("string.type", "Value must be a string");

// Issue with params
const rangeError = new GGRangeIssue("string.range", "Length must be between {min} and {max}");

// Usage in parse()
if (typeof value !== 'string') {
    return typeError.add(value, issues, path);
}
if (value.length < this.def.minLength) {
    return rangeError.add(value, issues, path, { min: this.def.minLength, max: this.def.maxLength });
}
```

---

## AOT Compilation (IsObject)

ObjectSchema uses dynamic function generation for maximum performance:

```typescript
// Generated is() check
const fastIs = new Function('s', 'v', `
    return typeof v === 'object' && v !== null
        && s.name.is(v.name)
        && s.age.is(v.age)
        && s.email.is(v.email);
`);

// Generated parse()
const fastParse = new Function('s', 'v', 'i', 'p', 'c', `
    if (typeof v !== 'object' || v === null) return undefined;
    var il = i.length, pp = p ? p + '.' : '';
    var name = s.name.parse(v.name, i, pp + 'name', c);
    var age = s.age.parse(v.age, i, pp + 'age', c);
    var email = s.email.parse(v.email, i, pp + 'email', c);
    if (i.length > il) return;
    return { name, age, email };
`);
```

Compilation happens lazily on first validation call.

---

## File Structure

```
packages/type/src/
├── common/
│   ├── types.ts              # Validator interface, Infer, Raw
│   ├── GGIssue.ts            # Base issue class
│   ├── GGIssuesList.ts       # Error collection
│   ├── GGIssueRegistry.ts    # Issue registration
│   ├── assertionError.ts     # Assertion error
│   └── issues/
│       ├── GGIssueInvalid.ts
│       └── GGRangeIssue.ts
├── core/
│   ├── FinalValidator.ts     # Base for final validators
│   ├── Brand.ts              # Brand type and registry
│   └── cache.ts              # Caching utilities
├── chainable/
│   ├── StringSchema.ts
│   ├── NumberSchema.ts
│   ├── BooleanSchema.ts
│   ├── ObjectSchema.ts
│   └── ArraySchema.ts
├── final/
│   ├── IsEmail.ts
│   ├── IsUrl.ts
│   ├── IsUuid.ts
│   ├── IsInt.ts
│   ├── IsUint.ts
│   ├── IsLatitude.ts
│   └── IsLongitude.ts
├── composite/
│   ├── IsUnion.ts
│   ├── IsLiteral.ts
│   └── DiscriminatedUnion.ts
└── index.ts
```

---

## Usage Examples

### Basic Types

```typescript
import { IsString, IsNumber, IsBoolean, IsObject, IsArray } from '@grest-ts/schema';

const IsUser = IsObject.of({
    name: IsString.minLength(1).maxLength(100),
    age: IsNumber.min(0).max(150).integer,
    email: IsEmail,
    isActive: IsBoolean,
    tags: IsArray(IsString),
});

type User = typeof IsUser.infer;
```

### Branded Types

```typescript
const IsUserId = IsNumber.min(1).integer.brand("UserId");
const IsUsername = IsString.minLength(3).maxLength(50).brand("Username");

type tUserId = typeof IsUserId.infer;
type tUsername = typeof IsUsername.infer;

const IsUserRef = IsObject.of({
    id: IsUserId,
    username: IsUsername,
});
```

### Optional Fields

```typescript
const IsProfile = IsObject.of({
    bio: IsString.orUndefined,
    website: IsUrl.orUndefined,
    location: IsString.orNull,
});
```

### Unions & Literals

```typescript
const Status = IsLiteral("draft", "published", "archived");
const IdOrName = IsUnion(IsNumber, IsString);
```

### Discriminated Unions

```typescript
const IsNotification = IsObject.discriminated("type", [
    IsObject.of({
        type: IsLiteral("email"),
        to: IsEmail,
        subject: IsString,
    }),
    IsObject.of({
        type: IsLiteral("sms"),
        phone: IsString,
        message: IsString,
    }),
]);
```

### Circular References

```typescript
const IsTreeNode = IsObject.of(() => ({
    value: IsString,
    children: IsArray(IsTreeNode),
}));
```

### Validation

```typescript
const issues = new GGIssuesList();
const user = IsUser.parse(data, issues, "");

if (issues.hasIssues()) {
    return { error: issues.toJSON() };
}

// user is typed as User
console.log(user.name);
```
