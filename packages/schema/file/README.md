<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/file

Unified file abstraction for the Grest framework. Works across HTTP (multipart upload/download), WebSocket (base64 JSON), and tests (in-memory buffers) with a single API.

## In-memory files — when to use

`GGFile` holds file content **in Node.js process memory**. The entire file is buffered as a `Uint8Array` (or lazily read from a browser `File`/`Blob`). This is simple and works great for prototyping, internal tools, and smaller applications where files are modest in size.

For production systems handling large files or high throughput, pass files through your server to an object store (S3, GCS, R2, etc.) and work with URLs/keys instead. A common pattern is to have your upload endpoint stream directly to S3 and return a URL, rather than buffering the whole file in memory. This keeps memory usage predictable and avoids OOM under load.

## Features

- Single `GGFile` type used everywhere — contracts, services, clients, and tests
- Schema validation with `IsFile` — MIME type filtering and size limits
- Single-consumption model prevents accidental double-reads
- Works in Node.js and browsers (wraps native `File`/`Blob` lazily)
- Testkit with ready-made files (PNG, JPEG, PDF, CSV, JSON, random bytes)

## Quick Example

### Defining a contract with file fields

```typescript
import { IsFile } from "@grest-ts/file"
import { IsObject, IsString, IsArray } from "@grest-ts/schema"

// Accept any file
const IsUploadRequest = IsObject({
    file: IsFile,
    description: IsString.orUndefined
})

// Accept images only, max 5 MB
const IsAvatarRequest = IsObject({
    image: IsFile.accept('image/*').maxSize(5 * 1024 * 1024)
})

// Multiple files
const IsBatchRequest = IsObject({
    files: IsArray(IsFile),
    metadata: IsObject({ tags: IsArray(IsString) })
})

// File as output (for downloads)
const contract = {
    downloadReport: {
        input: IsObject({ reportId: IsString }),
        success: IsFile,
        errors: [SERVER_ERROR]
    }
}
```

### Reading file content in a service

```typescript
import { GGFile } from "@grest-ts/file"

async function handleUpload(file: GGFile): Promise<void> {
    console.log(file.name)      // "report.pdf"
    console.log(file.mimeType)  // "application/pdf"
    console.log(file.size)      // 1048576

    // Read the content (can only be called once)
    const bytes = await file.buffer()
    // or: const text = await file.text()
    // or: const stream = file.stream()
}
```

### Returning a file from a service

```typescript
async function downloadReport(request: { reportId: string }): Promise<GGFile> {
    const content = await generateReport(request.reportId)
    return GGFile.fromString(content, "report.csv", "text/csv")
}
```

## GGFile

Abstract base class representing a file. All file operations flow through this type.

### Properties

| Property | Type | Description |
|---|---|---|
| `name` | `string` | File name (e.g. `"photo.jpg"`) |
| `mimeType` | `string` | MIME type (e.g. `"image/jpeg"`) |
| `size` | `number` | Size in bytes |
| `consumed` | `boolean` | Whether the content has been read |

### Reading content

Each file can only be read **once**. After calling any of these methods, the file is marked as consumed and further reads throw an error. Use `clone()` if you need multiple reads.

```typescript
// Read as Uint8Array
const bytes = await file.buffer()

// Read as UTF-8 string
const text = await file.text()

// Read as ReadableStream
const stream = file.stream()

// Create an independent copy (before consuming)
const copy = file.clone()
const bytes1 = await copy.buffer()
const bytes2 = await file.buffer()  // still works
```

### Factory methods

```typescript
// From raw bytes
GGFile.fromBuffer(data: Uint8Array, name: string, mimeType?: string): GGFile

// From a string (UTF-8 encoded)
GGFile.fromString(content: string, name: string, mimeType?: string): GGFile

// From base64 (used internally for WebSocket transport)
GGFile.fromBase64(base64: string, name: string, mimeType?: string): GGFile

// From a browser <input type="file"> (lazy — reads only when consumed)
GGFile.fromBrowserFile(file: File): GGFile
```

### Serialization

Files are automatically serialized for transport — multipart `FormData` over HTTP, base64 JSON over WebSocket. You don't need to call these directly, but they're available:

```typescript
// Convert to base64 string (consumes the file)
const b64 = await GGFile.toBase64(file)

// Serialize to JSON (consumes the file)
const json = await GGFile.toJSON(file)
// { __ggfile: true, name: "...", mimeType: "...", size: 123, data: "base64..." }

// Deserialize from JSON
const restored = GGFile.fromJSON(json)

// Check if a value is serialized GGFile JSON
GGFile.isJSON(value) // boolean
```

## IsFile (Schema)

`IsFile` is a `GGSchema` for validating files in contracts. It supports MIME type filtering and size limits.

```typescript
import { IsFile } from "@grest-ts/file"

// Accept any file
IsFile

// Constrain by MIME type
IsFile.accept('image/*')                    // any image
IsFile.accept('image/png', 'image/jpeg')    // specific types
IsFile.accept('.pdf')                       // by extension
IsFile.accept('application/pdf')            // by MIME type

// Constrain by size
IsFile.maxSize(10 * 1024 * 1024)  // 10 MB

// Combine constraints
IsFile.accept('image/*').maxSize(5 * 1024 * 1024)

// Optional
IsFile.orUndefined
IsFile.orNull
```

### Static shortcuts

```typescript
FileSchema.image()                    // image/*
FileSchema.image({ maxSize: 5_000_000 })
FileSchema.pdf()                      // application/pdf
FileSchema.video()                    // video/*
FileSchema.audio()                    // audio/*
FileSchema.any()                      // no constraints
FileSchema.any({ maxSize: 50_000_000 })
```

### Validation errors

| Error code | Description |
|---|---|
| `file.type` | Value is not a file |
| `file.mimeType` | File type not in the `accept` list |
| `file.maxSize` | File exceeds the `maxSize` limit |

## Testkit

Import `@grest-ts/file/testkit` for test utilities that create `GGFile` instances without real I/O.

```typescript
import { GGTestFile } from "@grest-ts/file/testkit"
```

### Generators

```typescript
// From raw data
GGTestFile.fromBuffer(new Uint8Array([1, 2, 3]), 'data.bin')
GGTestFile.fromString('Hello', 'hello.txt')
GGTestFile.fromBase64('SGVsbG8=', 'hello.txt')

// Random bytes (useful for size-limit tests)
GGTestFile.random(1024, 'random.bin')
GGTestFile.random(6 * 1024 * 1024, 'too-large.png', 'image/png')

// Valid minimal files
GGTestFile.png1x1()             // 1x1 transparent PNG
GGTestFile.jpeg1x1()            // 1x1 red JPEG
GGTestFile.pdf()                // empty-page PDF

// Structured data
GGTestFile.json({ key: 'value' }, 'config.json')
GGTestFile.csv([
    ['Name', 'Age'],
    ['Alice', '30']
], 'users.csv')
```

### Test example

```typescript
import { callOn, GGTest } from "@grest-ts/testkit"
import { GGTestFile } from "@grest-ts/file/testkit"
import { VALIDATION_ERROR } from "@grest-ts/schema"

const api = callOn(FileUploadTestApi)

test('upload text file', async () => {
    const file = GGTestFile.fromString('Hello', 'hello.txt')

    await api
        .uploadFile({ file, description: 'greeting' })
        .toMatchObject({ fileName: 'hello.txt', size: 5 })
})

test('reject non-image uploads', async () => {
    const textFile = GGTestFile.fromString('not an image', 'doc.txt', 'text/plain')

    await api
        .uploadImage({ image: textFile })
        .toBeError(VALIDATION_ERROR)
})

test('reject oversized files', async () => {
    const large = GGTestFile.random(6 * 1024 * 1024, 'big.png', 'image/png')

    await api
        .uploadImage({ image: large })
        .toBeError(VALIDATION_ERROR)
})
```
