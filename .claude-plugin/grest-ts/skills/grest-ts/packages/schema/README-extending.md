# Extending Validator

How to create custom validators for `@grest-ts/schema`.

## Validator Interface

All validators must implement the `GGValidator<T>` interface:

```typescript
interface GGValidator<T> {
    // Type guard
    is(value: unknown): value is T;

    // Throws on validation failure
    assert(value: unknown): asserts value is T;

    // Parse with coercion (throws on failure)
    parse(value: unknown, coerce?: boolean): T;

    // Safe parse with error collection
    safeParse(value: unknown, coerce?: boolean): GGParseResult<T>;
}
```

## Types of validators

* **primitive** - `IsString`, `IsNumber`, etc. These are singleton instances, no need to create new ones.
* **primitive with arguments** - `IsEnum(MyEnum)` - needs input to validate against. Created via factory functions.
* **branded** - `IsEmail`, `IsInt` - validators with branded types for semantic meaning.
* **derived with constraints** - `IsInt.range(0, 100)` - created from base validators with added constraints.
* **composite** - `IsObject`, `IsArray`, `IsUnion`, `IsDiscriminated` - validators that combine multiple validators.

In overall, if your validator needs arguments, you create an instance of it. If it doesn't, you use static methods.
Both can also exist, for example IsObject static methods validate that it is object, while instance methods expect to validate the whole obejct structure.

## Creating Custom Validators

The recommended way to create custom validators is by extending or composing existing schemas:

```typescript
import {IsInt, IsString} from "@grest-ts/schema"

// Simple: Use .refine() for custom validation
const IsEvenNumber = IsInt.refine(
    (v) => v % 2 === 0,
    new GGIssueKey("number.even", "Value must be even")
);

// Simple: Use .range() for bounded numbers
const IsPercentage = IsInt.range(0, 100);

// Simple: Use .brand() for semantic types
const IsUserId = IsInt.brand<"UserId">();
```

## Custom Validators with Arguments

For validators that need constructor parameters, use the schema's `.refine()` method or create factory functions:

```typescript
import {IsString, GGIssueKey} from "@grest-ts/schema"

// Factory function for pattern validation
function IsStringPattern(pattern: RegExp, errorMessage: string) {
    const patternError = new GGIssueKey("string.pattern", errorMessage);
    return IsString.refine(
        (value) => pattern.test(value),
        patternError
    );
}

// Usage
const IsProductCode = IsStringPattern(
    /^[A-Z]{2}-\d{4}$/,
    "Must match format XX-0000"
);

const result = IsProductCode.safeParse("AB-1234");
if (result.success) {
    console.log(result.value); // "AB-1234"
}
```

## Custom Issue Types

Create validation issues with typed parameters:

```typescript
import {GGIssueKey, GGIssueInvalid, GGRangeIssue} from "@grest-ts/schema"

// Issue without parameters
const required = new GGIssueKey("field.required", "This field is required");

// Issue with parameters (for range validations)
const rangeError = new GGRangeIssue("value.range", "Value must be between {min} and {max}");

// Simple type validation errors
const typeError = new GGIssueInvalid("mytype.invalid", "Value must be a valid MyType");
```

## Extending Existing Validators

Build on existing validators using `.refine()` and `.brand()`:

```typescript
import {IsInt, GGIssueKey} from "@grest-ts/schema"

// Create a branded even integer validator
const evenError = new GGIssueKey("integer.even", "Value must be an even integer");

export const IsEvenInt = IsInt
    .refine((value) => value % 2 === 0, evenError)
    .brand<"EvenInt">();

export type tEvenInt = typeof IsEvenInt.infer;

// Usage
const result = IsEvenInt.safeParse(4);
if (result.success) {
    const evenNum: tEvenInt = result.value;
}
```

## Best Practices

### Reuse Base Validators

```typescript
// Good - leverage existing validation with .refine()
const IsNonEmptyString = IsString.refine(
    (s) => s.length > 0,
    new GGIssueKey("string.empty", "Value cannot be empty")
);

// Good - compose validators
const IsSlug = IsString
    .refine((s) => /^[a-z0-9-]+$/.test(s), new GGIssueKey("slug.format", "Invalid slug format"))
    .brand<"Slug">();
```

### Use Typed Issues

```typescript
// Good - use GGRangeIssue for range validations with typed parameters
const rangeError = new GGRangeIssue("value.range", "Value must be between {min} and {max}");

// Good - use GGIssueKey for simple validations
const formatError = new GGIssueKey("string.format", "Invalid format");
```

### Follow Naming Conventions

```typescript
// Types: use schema.infer
export const IsSlug = IsString
    .refine((s) => /^[a-z0-9-]+$/.test(s), new GGIssueKey("slug.format", "Invalid slug format"))
    .brand<"Slug">();

export type tSlug = typeof IsSlug.infer;

// Validators: IsPrefixed functions or constants
// Issues: category.specific
```
