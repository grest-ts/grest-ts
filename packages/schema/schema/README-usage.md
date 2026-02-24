# Validator Usage

How to use `@grest-ts/schema` in your application.

## Primitive Validators

Basic type validation:

```typescript
import {IsString, IsNumber, IsBoolean} from "@grest-ts/schema"

// Type guards
if (IsString.is(value)) {
    // value is string
}

// Assertions (throws on failure)
IsNumber.assert(value);

// Parse with coercion (throws on failure)
const num = IsNumber.parse(value, true);

// Safe parse with error collection
const result = IsNumber.safeParse(value, true);
if (!result.success) {
    console.log(result.issues.toJSON());
}
```

## Branded Validators

Semantic type validation with zero runtime overhead:

```typescript
import {IsInt, IsEmail, IsUrl, IsDate, tInt, tEmail} from "@grest-ts/schema"

// Type guards
if (IsEmail.is(value)) {
    // value is tEmail
}

// Parse with validation (throws on failure)
const email = IsEmail.parse(input);
const userId = IsInt.parse(input, true); // with coercion

// Safe parse with error collection
const result = IsEmail.safeParse(input);
if (!result.success) {
    console.log(result.issues.toJSON());
}
```

### Available Branded Validators

| Category           | Validators                                                                       |
|--------------------|----------------------------------------------------------------------------------|
| **Integers**       | `IsInt`, `IsPosInt`, `IsUint`                                                    |
| **Sized Integers** | `IsInt8`, `IsInt16`, `IsInt32`, `IsUint8`, `IsUint16`, `IsUint32`                |
| **Numbers**        | `IsNumber`, `IsPercentage`                                                       |
| **Ranges**         | Use `.range(min, max)` method on number schemas                                  |
| **Date/Time**      | `IsDate`, `IsDateTime`, `IsTime`, `IsTimestamp`, `IsTimestampMs`                 |
| **Strings**        | `IsEmail`, `IsUrl`, `IsIp`, `IsPhone`, `IsPassword`                              |
| **Geo**            | `IsLatitude`, `IsLongitude`, `IsCountry`, `IsLanguage`, `IsCurrency`             |

## Composite Validators

### IsObject

Schema-based object validation:

```typescript
import {IsObject, IsString, IsInt, IsEmail} from "@grest-ts/schema"

interface User {
    id: tInt;
    name: string;
    email: tEmail;
    age?: tInt;
}

const IsUser = IsObject({
    id: IsInt,
    name: IsString,
    email: IsEmail,
    age: IsInt.orUndefined
});

// Validate
if (IsUser.is(data)) {
    // data is User
}

// Parse with error collection
const result = IsUser.safeParse(data, true);
if (!result.success) {
    console.log(result.issues.toJSON());
}
```

### IsArray

Array validation:

```typescript
import {IsArray, IsString, IsInt} from "@grest-ts/schema"

const IsStringArray = IsArray(IsString);
const IsIntArray = IsArray(IsInt);

// Nested arrays
const IsMatrix = IsArray(IsArray(IsInt));
```

### IsUnion

Union type validation:

```typescript
import {IsUnion, IsString, IsNumber} from "@grest-ts/schema"

const IsStringOrNumber = IsUnion(IsString, IsNumber);

if (IsStringOrNumber.is(value)) {
    // value is string | number
}
```

### IsDiscriminated

Tagged union validation:

```typescript
import {IsDiscriminated, IsObject, IsString, IsInt, IsLiteral} from "@grest-ts/schema"

const IsCircle = IsObject({
    type: IsLiteral("circle"),
    radius: IsInt
});

const IsSquare = IsObject({
    type: IsLiteral("square"),
    side: IsInt
});

const IsShape = IsDiscriminated("type", {
    circle: IsCircle,
    square: IsSquare
});
```

### Optional and Nullable

Use `.orUndefined` and `.orNull` getters on any schema:

```typescript
import {IsInt} from "@grest-ts/schema"

// Optional field (T | undefined)
const IsOptionalInt = IsInt.orUndefined;

// Nullable field (T | null)
const IsNullableInt = IsInt.orNull;

// Optional and nullable (T | null | undefined)
const IsMaybeInt = IsInt.orNull.orUndefined;
```

## Enums and Literals

```typescript
import {IsEnum, IsLiteral} from "@grest-ts/schema"

// Enum validation
enum Status { Active = "active", Inactive = "inactive" }

const IsStatus = IsEnum(Status);

// Single literal
const IsActive = IsLiteral("active");

// Union of literals
const IsRole = IsLiteral("admin", "user", "guest");
```

## Error Handling

### GGIssuesList

Collect all validation errors:

```typescript
import {IsObject, IsString, IsInt} from "@grest-ts/schema"

const IsUser = IsObject({
    name: IsString,
    age: IsInt
});

const result = IsUser.safeParse({name: 123, age: "invalid"});

if (!result.success) {
    // Get JSON representation with messages translated.
    console.log(result.issues.toJSON());
    // [
    //   { path: "name", code: "string.type", message: "Value must be a string" },
    //   { path: "age", code: "integer.type", message: "Value must be an integer" }
    // ]
}
```

### Assert with Exceptions

```typescript
try {
    IsUser.assert(data);
    // data is valid User
} catch (error) {
    // GGIssuesList with validation issues
}
```

## Coercion

Parse string inputs to typed values (useful for API query/path parameters):

```typescript
import {IsInt, IsBoolean} from "@grest-ts/schema"

// String to number (with coercion enabled)
const id = IsInt.parse("123", true);  // returns 123

// String to boolean (with coercion enabled)
const flag = IsBoolean.parse("true", true);  // returns true
```

## Custom Branded Types

Create domain-specific branded types:

```typescript
import {IsInt} from "@grest-ts/schema"

// Create branded validator
const IsUserId = IsInt.brand<"UserId">();

// Infer the type from the validator
type tUserId = typeof IsUserId.infer;

// Usage
const userId = IsUserId.parse(rawId, true); // throws on error
// userId is tUserId type
```

## Object-Level Validation

Use `.refine()` to add custom checks that run after property validation:

```typescript
import {IsObject, IsInt, GGIssueKey} from "@grest-ts/schema"

const ageRangeError = new GGIssueKey("age.range", "minAge must be less than or equal to maxAge");

const IsAgeRange = IsObject({
    minAge: IsInt,
    maxAge: IsInt
}).refine(
    (value) => value.minAge <= value.maxAge,
    ageRangeError
);
```

## Best Practices

### Use Branded Types for Domain Modeling

```typescript
// Good - semantic types
interface User {
    id: tInt;
    email: tEmail;
    createdAt: tTimestamp;
}

// Avoid - plain primitives lose semantic meaning
interface User {
    id: number;
    email: string;
    createdAt: number;
}
```

### Collect All Errors

```typescript
// Good - collect all issues for better UX
const result = IsUser.safeParse(data, true);
if (!result.success) {
    return {errors: result.issues.toJSON()};
}

// Avoid - stopping at first error
if (!IsUser.is(data)) {
    return {error: "Invalid user"};
}
```

### Use Coercion for API Inputs

```typescript
// Good - handle string inputs from query params
const page = IsInt.parse(req.query.page, true);

// Works with: "123" -> 123
```
