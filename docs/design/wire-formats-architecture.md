# Wire Formats Architecture

## Overview

This document describes the architecture for serializing/deserializing typed data across different wire formats (JSON, Multipart, URL, etc.) while maintaining AOT optimization capabilities.

## Core Principles

1. **Schema describes, Format encodes** - Schema defines type structure, wire formats handle encoding
2. **AOT flattens everything** - Conceptual layers don't become runtime overhead
3. **Format-centric API** - Formats are the actors, schemas are configuration
4. **Composition without cost** - Formats can use other formats (multipart uses JSON), AOT inlines it

## Package Structure

```
@grest-ts/schema           - Core schema definitions, validation, AOT compiler
@grest-ts/schema-file      - GGFile type, FileSchema
@grest-ts/schema-date      - Date handling (IsDateObj, etc.)
@grest-ts/schema-binary    - Int8Array, Uint8Array, ArrayBuffer, etc.

@grest-ts/wire-json        - JSON wire format
@grest-ts/wire-multipart   - Multipart wire format (for HTTP with files)
@grest-ts/wire-url         - URL query string wire format
@grest-ts/wire-base64json  - JSON with base64-encoded binary (for WebSocket)

@grest-ts/http             - HTTP client (uses wire formats)
@grest-ts/http-server      - HTTP server utilities
```

## Key Abstractions

### Schema

Schema defines the type structure and knows about type conversions:

```typescript
const UserUpload = IsObject({
    name: IsString,
    avatar: IsFile,
    createdAt: IsDateObj,
    metadata: IsObject({
        tags: IsArray(IsString),
        binary: IsInt8Array
    })
})
```

Schema properties relevant to wire formats:
- `hasNonJsonData: boolean` - True if schema contains binary data (files, typed arrays)
- `toRaw(value): RawValue` - Converts typed value to raw representation
- `fromRaw(raw): TypedValue` - Converts raw representation to typed value

### Raw Representations

Each non-JSON type has a "raw" representation that's a standard intermediate:

| Typed Value | Raw Representation |
|-------------|-------------------|
| `Date` | ISO 8601 string |
| `GGFile` | `RawBinaryData { buffer, filename?, mimeType }` |
| `Int8Array` | `RawBinaryData { buffer, mimeType: 'application/octet-stream' }` |
| `Uint8Array` | `RawBinaryData { buffer, mimeType: 'application/octet-stream' }` |
| `BigInt` | string |

**Important:** Raw representation is a *conceptual* layer. AOT eliminates it at compile time.

### Wire Format Interface

```typescript
interface WireFormat<Output> {
    readonly name: string
    readonly supportsBinary: boolean

    serialize<T>(schema: GGSchema<T>, data: T): Output | Promise<Output>
    deserialize<T>(schema: GGSchema<T>, wire: Output): T

    // Optional: format-specific configuration
    with(options: FormatOptions): WireFormat<Output>
}
```

## Wire Formats

### JsonWire

Standard JSON encoding. Throws if schema contains binary data.

```typescript
import { JsonWire } from '@grest-ts/wire-json'

const json = JsonWire.serialize(UserSchema, userData)
// Returns: string

const data = JsonWire.deserialize(UserSchema, jsonString)
// Returns: User
```

**Capabilities:**
- `supportsBinary: false`
- Handles: strings, numbers, booleans, objects, arrays, null
- Converts: Date → ISO string, BigInt → string
- Throws: if schema has `hasNonJsonData: true`

### MultipartWire

Multipart encoding for HTTP. Supports binary data.

```typescript
import { MultipartWire } from '@grest-ts/wire-multipart'

const result = await MultipartWire.serialize(UploadSchema, uploadData)
// Returns: MultipartBody { operations: string, map: Record<string, string[]>, files: RawFile[] }

// Or directly to FormData
const formData = await MultipartWire.toFormData(UploadSchema, uploadData)
```

**Capabilities:**
- `supportsBinary: true`
- JSON-able data goes to `operations` (uses JsonWire internally)
- Binary data extracted to `files` array
- `map` tracks which file index corresponds to which JSON path

**Wire structure:**
```typescript
interface MultipartBody {
    operations: string                    // JSON string with nulls for binary fields
    map: Record<string, string[]>         // { "0": ["avatar"], "1": ["metadata.binary"] }
    files: RawFile[]                      // Binary data in order
}

interface RawFile {
    buffer: Uint8Array
    filename?: string
    mimeType: string
}
```

### UrlWire

URL query string encoding. For GET requests with query parameters.

```typescript
import { UrlWire } from '@grest-ts/wire-url'

const queryString = UrlWire.serialize(FilterSchema, filters)
// Returns: "name=John&page=1&tags=a&tags=b"

const data = UrlWire.deserialize(FilterSchema, queryString)
// Returns: { name: "John", page: 1, tags: ["a", "b"] }
```

**Capabilities:**
- `supportsBinary: false`
- Coerces strings to proper types on deserialize (string "1" → number 1)
- Arrays encoded as repeated keys
- Nested objects encoded with dot notation or brackets

### Base64JsonWire

JSON with base64-encoded binary data. For WebSocket or environments where multipart isn't available.

```typescript
import { Base64JsonWire } from '@grest-ts/wire-base64json'

const json = await Base64JsonWire.serialize(UploadSchema, uploadData)
// Returns: string (JSON with binary data as base64 strings)

const data = Base64JsonWire.deserialize(UploadSchema, jsonString)
```

**Capabilities:**
- `supportsBinary: true` (via base64 encoding)
- Binary data encoded inline as base64 strings
- Larger payload size but works over JSON-only transports

## AOT Compilation

### The Key Insight

Conceptual layers (typed → raw → wire) are flattened by AOT into single-pass code.

### JSON AOT Example

Schema:
```typescript
const User = IsObject({
    name: IsString,
    createdAt: IsDateObj,
    age: IsNumber
})
```

AOT generates:
```typescript
function serialize_User(data: User): string {
    return '{"name":' + JSON.stringify(data.name) +
           ',"createdAt":"' + data.createdAt.toISOString() +
           '","age":' + data.age + '}'
}
```

No intermediate "raw" object. Date conversion inlined.

### Multipart AOT Example

Schema:
```typescript
const Upload = IsObject({
    title: IsString,
    file: IsFile,
    createdAt: IsDateObj
})
```

AOT generates:
```typescript
async function serialize_Multipart_Upload(data: Upload): Promise<MultipartBody> {
    const files: RawFile[] = []

    // JSON part built directly (inlined fast stringify)
    const operations = '{"title":' + JSON.stringify(data.title) +
                       ',"file":null' +
                       ',"createdAt":"' + data.createdAt.toISOString() + '"}'

    // File extraction inline
    files.push({
        buffer: await data.file.clone().buffer(),
        filename: data.file.name,
        mimeType: data.file.mimeType
    })

    return {
        operations,
        map: { "0": ["file"] },
        files
    }
}
```

Single pass. JSON stringify is inlined. File extraction happens inline.

### Format Composition in AOT

Multipart uses JSON for the operations part. AOT doesn't call JsonWire separately - it inlines the JSON generation:

```
Conceptual: MultipartWire.serialize() → calls JsonWire.serialize() for JSON part
AOT:        serialize_Multipart_X() → JSON building is inlined, no function call
```

## Data Flow

### Serialize (Typed → Wire)

```
┌─────────────────────────────────────────────────────────────┐
│                     Typed Data                               │
│  { name: "John", avatar: GGFile, createdAt: Date }          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Wire Format   │
                    │   (with schema) │
                    └─────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
      ┌──────────┐     ┌──────────────┐   ┌──────────┐
      │ JsonWire │     │MultipartWire │   │ UrlWire  │
      │ (throws) │     │              │   │ (throws) │
      └──────────┘     └──────────────┘   └──────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MultipartBody                             │
│  operations: '{"name":"John","avatar":null,"createdAt":...}'│
│  map: { "0": ["avatar"] }                                   │
│  files: [{ buffer: Uint8Array, mimeType: "image/png", ...}] │
└─────────────────────────────────────────────────────────────┘
```

### Deserialize (Wire → Typed)

```
┌─────────────────────────────────────────────────────────────┐
│                    MultipartBody                             │
│  (from HTTP multipart parser)                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ MultipartWire   │
                    │ .deserialize()  │
                    │   (with schema) │
                    └─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Typed Data                               │
│  { name: "John", avatar: BufferGGFile, createdAt: Date }    │
└─────────────────────────────────────────────────────────────┘
```

## HTTP Integration

### Client

```typescript
import { HttpClient } from '@grest-ts/http'
import { MultipartWire } from '@grest-ts/wire-multipart'
import { JsonWire } from '@grest-ts/wire-json'

const client = new HttpClient({ baseUrl: 'https://api.example.com' })

// Client uses appropriate wire format based on schema
const response = await client.post('/upload', {
    schema: UploadSchema,
    data: uploadData,
    // Wire format chosen automatically:
    // - JsonWire if schema.hasNonJsonData is false
    // - MultipartWire if schema.hasNonJsonData is true
    // Or explicitly:
    wire: MultipartWire
})
```

### Server

```typescript
import { parseRequest } from '@grest-ts/http-server'
import { MultipartWire } from '@grest-ts/wire-multipart'

// Server detects Content-Type and uses appropriate wire format
const data = await parseRequest(request, UploadSchema)
// Content-Type: application/json → JsonWire.deserialize()
// Content-Type: multipart/form-data → MultipartWire.deserialize()
```

## Transport Comparison

| Transport | Binary Support | Wire Format |
|-----------|---------------|-------------|
| HTTP + JSON | No | JsonWire |
| HTTP + Multipart | Yes | MultipartWire |
| WebSocket | No (use base64) | Base64JsonWire |
| Worker postMessage | Yes (transferables) | StructuredCloneWire |
| URL query string | No | UrlWire |

## API Summary

### Format-Centric API

```typescript
// Serialize
const json = JsonWire.serialize(schema, data)
const multipart = await MultipartWire.serialize(schema, data)
const formData = await MultipartWire.toFormData(schema, data)
const url = UrlWire.serialize(schema, data)

// Deserialize
const data = JsonWire.deserialize(schema, jsonString)
const data = MultipartWire.deserialize(schema, multipartBody)
const data = UrlWire.deserialize(schema, queryString)

// Format configuration
const StrictJson = JsonWire.with({ strict: true })
const LargeMultipart = MultipartWire.with({ maxFileSize: 100_000_000 })
```

### Schema API (for checking capabilities)

```typescript
schema.def.hasNonJsonData  // boolean - true if contains binary data

// Used by HTTP client to auto-select format:
if (schema.def.hasNonJsonData) {
    return MultipartWire.serialize(schema, data)
} else {
    return JsonWire.serialize(schema, data)
}
```

## Interpreted Fallback

For non-AOT environments, each wire format provides an interpreted implementation that traverses the schema at runtime. This is slower but works without compilation.

```typescript
// Interpreted mode (runtime traversal)
JsonWire.serialize(schema, data)  // Walks schema.def.shape, converts each field

// AOT mode (generated code)
serialize_Json_UserSchema(data)   // Direct property access, no traversal
```

The API is the same. AOT compilation generates optimized versions that replace the interpreted implementations.

## Migration Path

1. Start with interpreted implementations (works immediately)
2. Add AOT compilation for hot paths
3. AOT generates format-specific serialize/deserialize functions
4. Runtime automatically uses AOT-generated code when available

## Future Extensions

### Custom Wire Formats

```typescript
import { defineWireFormat } from '@grest-ts/wire-core'

const MsgPackWire = defineWireFormat({
    name: 'msgpack',
    supportsBinary: true,
    serialize(schema, data) { /* ... */ },
    deserialize(schema, wire) { /* ... */ }
})
```

### Streaming Formats

```typescript
const StreamingJsonWire = JsonWire.streaming({
    onValue: (path, value) => { /* ... */ }
})
```

### Compression

```typescript
const CompressedMultipart = MultipartWire.with({
    compress: 'gzip'
})
```
