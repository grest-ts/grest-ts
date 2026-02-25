<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/file-http

HTTP codecs for file uploads and downloads in the Grest framework. Handles multipart `FormData` encoding for uploads and binary response streaming for downloads — automatically, on both client and server.

## In-memory files — when to use

Both `GGFileUpload` and `GGFileDownload` buffer the entire file in Node.js process memory. On upload, Busboy collects all chunks into a `Buffer`; on download, the full file is written to the response at once. This is simple and works great for prototyping, internal tools, and smaller applications.

For production systems handling large files or high throughput, consider uploading directly to an object store (S3, GCS, R2, etc.) — for example via presigned URLs — and passing only the resulting key/URL through your API. This keeps memory usage predictable and avoids OOM under load.

## Quick Example

```typescript
import { httpSchema } from "@grest-ts/http"
import { GGFileUpload, GGFileDownload } from "@grest-ts/file-http"
import { GGContractClass, IsObject, IsString, IsArray, VALIDATION_ERROR, SERVER_ERROR } from "@grest-ts/schema"
import { IsFile } from "@grest-ts/file"

const FileApiContract = new GGContractClass("FileApi", {
    upload: {
        input: IsObject({ file: IsFile, description: IsString.orUndefined }),
        success: IsObject({ fileName: IsString, size: IsNumber }),
        errors: [VALIDATION_ERROR]
    },
    uploadBatch: {
        input: IsObject({
            files: IsArray(IsFile),
            metadata: IsObject({ tags: IsArray(IsString) })
        }),
        success: IsObject({ count: IsNumber }),
        errors: [VALIDATION_ERROR]
    },
    download: {
        input: IsObject({ id: IsString }),
        success: IsFile,
        errors: [SERVER_ERROR]
    }
})

export const FileApi = httpSchema(FileApiContract)
    .pathPrefix("api/files")
    .routes({
        upload:      GGFileUpload.POST("upload"),
        uploadBatch: GGFileUpload.POST("upload-batch"),
        download:    GGFileDownload.GET("download")
    })
```

That's it — the codecs handle multipart encoding, binary streaming, content headers, and filename preservation on both sides.

## GGFileUpload

Codec for uploading files from client to server via `multipart/form-data`.

```typescript
import { GGFileUpload } from "@grest-ts/file-http"

GGFileUpload.POST(path)
```

### How it works

**Client side:** Splits the input into a `FormData` body:
- A `__json` field containing all non-file data as JSON
- Each file field appended as a binary part with its filename and MIME type
- `Content-Type` header is **not** set explicitly — `fetch()` auto-detects the multipart boundary

**Server side:** Uses [Busboy](https://github.com/mscdex/busboy) for streaming multipart parsing:
- Extracts the `__json` field and parses it
- Collects each file part into a `GGFile` via the schema's `decodeFromRaw()`
- Reassembles the full input object with files at their original paths
- Handles array fields (e.g. `files.0`, `files.1`) via wildcard matching

### Usage rules

| Rule | Reason |
|---|---|
| Only `POST` is supported | Multipart upload requires a request body |
| Input **must** contain at least one file field | Use `GGRpc.POST` for JSON-only routes |
| Output is standard JSON | Use `GGFileDownload` for file responses |

### Mixed file + JSON data

Files and JSON data are sent together in a single request. The codec automatically separates them:

```typescript
const IsUploadRequest = IsObject({
    file: IsFile,                          // sent as binary part
    description: IsString.orUndefined,     // sent in __json
    tags: IsArray(IsString)                // sent in __json
})
```

### File arrays

Arrays of files work naturally:

```typescript
const IsBatchRequest = IsObject({
    files: IsArray(IsFile),                // each file sent as files.0, files.1, ...
    metadata: IsObject({ category: IsString })
})
```

## GGFileDownload

Codec for downloading files from server to client as binary HTTP responses.

```typescript
import { GGFileDownload } from "@grest-ts/file-http"

GGFileDownload.GET(path)
GGFileDownload.POST(path)
```

### How it works

**Server side:** Sends the file as a binary response:
- `Content-Type` set from the file's MIME type
- `Content-Length` set from file size
- `Content-Disposition` set with the filename (URL-encoded)
- Error responses are sent as JSON with the appropriate status code

**Client side:** Parses the binary response:
- Reads `arrayBuffer()` from the response
- Extracts filename from `Content-Disposition` header
- Creates a `GGFile` instance via the schema's `decodeFromRaw()`
- JSON error responses are parsed normally

### Usage rules

| Rule | Reason |
|---|---|
| `GET` or `POST` supported | GET for simple lookups, POST for complex queries |
| Output **must** be a file schema (e.g. `IsFile`) | Use `GGRpc.GET/POST` for JSON responses |
| Input must be JSON-only | File download routes accept JSON input, not file uploads |

### GET vs POST downloads

```typescript
.routes({
    // GET — parameters sent as query string
    downloadById: GGFileDownload.GET("download"),

    // POST — parameters sent as JSON body
    generateReport: GGFileDownload.POST("generate-report")
})
```

Use `GET` for simple key-based lookups. Use `POST` when the request body is complex.

## Service Implementation

Services return `GGFile` for downloads and receive `GGFile` for uploads — no transport details leak into business logic:

```typescript
import { GGFile } from "@grest-ts/file"

class FileService implements IFileApi {
    async upload(request: { file: GGFile, description?: string }) {
        const bytes = await request.file.buffer()
        await storage.save(request.file.name, bytes)
        return { fileName: request.file.name, size: request.file.size }
    }

    async download(request: { id: string }): Promise<GGFile> {
        const data = await storage.load(request.id)
        return GGFile.fromBuffer(data.bytes, data.name, data.mimeType)
    }
}
```

## Browser Support

The package has separate entry points for Node.js and browsers:

| Entry | Client | Server |
|---|---|---|
| Node.js (`default`) | Full support | Full support |
| Browser (`browser`) | Full support | Throws error |

Browser builds only include client-side codecs (request building and response parsing). Server-side codecs (`createForServer`) throw an error in the browser since they depend on Node.js APIs (`http.IncomingMessage`, Busboy).

This is handled automatically by bundlers via the `browser` export condition — no configuration needed.

## Path Parameters

Upload routes support path parameters:

```typescript
.routes({
    uploadAvatar: GGFileUpload.POST("users/:userId/avatar")
})

// Client call:
await api.uploadAvatar({ userId: "123", avatar: file })
// → POST /api/files/users/123/avatar
```
