# Codec & Transform

Type-safe data transformation with bidirectional schema documentation.

## Overview

Codecs and Transforms provide **documented transformations** between data formats. Unlike simple functions, they preserve schema metadata on both input and output sides.

### The Core Idea: Shared API Documentation

The main purpose of Codecs is to **define transformation logic once and share it across boundaries**. A single Codec definition serves as both implementation and documentation that any party can execute:

- **Client** encodes data before sending (e.g., `AuthInfo` -> `Authorization` header)
- **Server** decodes data after receiving (e.g., `Authorization` header -> `AuthInfo`)
- **Server-to-Server** can do both directions as needed

This means your API transformation logic is:
1. **Defined once** - No duplicate encode/decode implementations
2. **Self-documenting** - Input and output schemas are always available
3. **Executable by any party** - Client, server, or tooling can run it
4. **Automatically consistent** - Both sides use the exact same transformation

### Benefits

- OpenAPI documentation generation from schema metadata
- Type-safe bidirectional transformations (encode/decode)
- Composable transformation pipelines
- Runtime validation of both input and output

## GGTransform

A single-direction transformation with input and output schemas.

```typescript
import {GGTransform} from "@grest-ts/schema"
import {IsString, IsNumber, IsObject} from "@grest-ts/schema"

// Transform string to number
const StringToNumber = new GGTransform(
    IsString,           // input schema
    IsNumber,           // output schema
    (s) => parseInt(s, 10)  // transform function
);

// Use the transform
const result = StringToNumber.encode("42");
if (result.success) {
    console.log(result.value);  // 42
}
```

### Validation Semantics

Transform validates both input and output with different error handling:

- **Input validation failure** - Returns error result (bad user data)
- **Output validation failure** - Throws exception (coding error in transform)

```typescript
// Invalid input - returns error
const result = StringToNumber.encode(123 as any);
// result.success === false, result.issues contains validation errors

// Invalid output - throws (bug in your transform function)
const BadTransform = new GGTransform(
    IsString,
    IsNumber,
    () => "not a number" as any  // Bug: returns wrong type
);
BadTransform.encode("test");  // Throws SERVER_ERROR
```

### Chaining Transforms

```typescript
const StringToNumber = new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10));
const NumberToBoolean = new GGTransform(IsNumber, IsString, (n) => n > 0 ? "true" : "false");

// Chain: String -> Number -> String("true"/"false")
const StringToBoolString = StringToNumber.transformTo(NumberToBoolean);

const result = StringToBoolString.encode("42");
// result.value === "true"
```

## GGCodec

Bidirectional transformation with encode and decode operations.

```typescript
import {GGCodec, GGTransform} from "@grest-ts/schema"
import {IsString, IsObject} from "@grest-ts/schema"

const AuthInfoSchema = IsObject({
    userId: IsString,
    token: IsString
});

const AuthHeaderCodec = new GGCodec({
    encode: new GGTransform(
        AuthInfoSchema,
        IsString,
        (info) => `Bearer ${info.userId}:${info.token}`
    ),
    decode: new GGTransform(
        IsString,
        AuthInfoSchema,
        (header) => {
            const [, payload] = header.split(' ');
            const [userId, token] = payload.split(':');
            return {userId, token};
        }
    )
});

// Encode: AuthInfo -> Header string
const encoded = AuthHeaderCodec.encode({userId: 'user123', token: 'abc'});
// encoded.value === "Bearer user123:abc"

// Decode: Header string -> AuthInfo
const decoded = AuthHeaderCodec.decode('Bearer user123:abc');
// decoded.value === {userId: 'user123', token: 'abc'}
```

### Chaining Codecs

```typescript
const StringNumberCodec = new GGCodec({
    encode: new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10)),
    decode: new GGTransform(IsNumber, IsString, (n) => n.toString())
});

const NumberBoolCodec = new GGCodec({
    encode: new GGTransform(IsNumber, IsString, (n) => n > 0 ? "positive" : "zero"),
    decode: new GGTransform(IsString, IsNumber, (s) => s === "positive" ? 1 : 0)
});

// Chain codecs: String <-> Number <-> String
const chained = StringNumberCodec.codecTo(NumberBoolCodec);

chained.encode("42");   // "positive"
chained.decode("positive");  // "1"
```

## Use Cases

### API Header Transformation

```typescript
const AuthHeaderCodec = new GGCodec({
    encode: new GGTransform(AuthInfoSchema, IsString, (info) => `Bearer ${info.token}`),
    decode: new GGTransform(IsString, AuthInfoSchema, parseAuthHeader)
});

// Server: decode incoming header
const authInfo = AuthHeaderCodec.decode(req.headers.authorization);

// Client: encode outgoing header
const header = AuthHeaderCodec.encode({userId: '123', token: 'abc'});
```

### Data Serialization

```typescript
// IsDate validates YYYY-MM-DD string format
// Transform between date string and timestamp number
const DateTimestampCodec = new GGCodec({
    encode: new GGTransform(IsDate, IsNumber, (dateStr) => new Date(dateStr).getTime()),
    decode: new GGTransform(IsNumber, IsDate, (ts) => new Date(ts).toISOString().split('T')[0])
});

// Encode: "2024-01-15" -> 1705276800000
const timestamp = DateTimestampCodec.encode("2024-01-15");

// Decode: 1705276800000 -> "2024-01-15"
const dateStr = DateTimestampCodec.decode(1705276800000);
```

### OpenAPI Documentation

Since transforms preserve both input and output schemas, tools can generate accurate API documentation:

```typescript
const transform = new GGTransform(InputSchema, OutputSchema, transformFn);

// Access schemas for documentation generation
transform.inputSchema   // Request body schema
transform.outputSchema  // Wire format schema
```

## Best Practices

### Validate Output Schemas

Always define accurate output schemas. Output validation catches bugs in your transform functions early:

```typescript
// Good - output schema matches what transform returns
const Transform = new GGTransform(
    IsString,
    IsObject({id: IsNumber, name: IsString}),
    (s) => ({id: parseInt(s), name: `User ${s}`})
);

// Bad - output schema doesn't match, will throw at runtime
const BadTransform = new GGTransform(
    IsString,
    IsNumber,  // Says it returns number
    (s) => ({id: s})  // Actually returns object - throws!
);
```

### Use Codecs for Bidirectional Data

When data flows both ways (client/server, serialize/deserialize), use GGCodec:

```typescript
// Good - bidirectional transformation
const UserCodec = new GGCodec({
    encode: new GGTransform(UserSchema, UserDTOSchema, toDTO),
    decode: new GGTransform(UserDTOSchema, UserSchema, fromDTO)
});

// Avoid - separate unrelated transforms
const toDTO = new GGTransform(UserSchema, UserDTOSchema, ...);
const fromDTO = new GGTransform(UserDTOSchema, UserSchema, ...);
```

### Chain vs Compose

Use `transformTo`/`codecTo` for pipelines, not nested function calls:

```typescript
// Good - composable chain
const pipeline = step1.transformTo(step2).transformTo(step3);

// Avoid - nested calls lose schema metadata
const result = step3.encode(step2.encode(step1.encode(input)));
```
