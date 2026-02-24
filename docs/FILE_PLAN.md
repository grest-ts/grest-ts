# Plan: Redesign GGFile and Schema Wire Layer

## Overview

Redesign the `@grest-ts/file` package with a unified `GGFile` class that transparently handles both buffered and streaming modes. Add a schema-aware "Wire" layer for optimized serialization/deserialization of data containing files.

## Goals

1. **Unified GGFile** - Single type handles buffered and streaming, user doesn't think about it
2. **Native types** - Use `Blob`, `File`, `ReadableStream` internally where possible
3. **Zero-copy pass-through** - Files forwarded between services stream without buffering
4. **AOT-optimized Wire layer** - Schema knows file locations, O(k) not O(n) operations
5. **Cross-environment** - Works in browser and Node.js 20+
6. **Clean architecture** - No duck typing, proper types, clear layer boundaries

## Architecture

```
Domain Layer (GGFile - unified interface)
    ↓↑
Schema Layer (IsFile validates, knows structure via AOT)
    ↓↑
Wire Layer (schema-aware serialize/deserialize)
    ↓↑
Transport Layer (HTTP/WebSocket - just sends bytes)
    ↓↑
Network
```

## Design

### GGFile Class

```typescript
// packages/schema/file/src/GGFile.ts

/**
 * Unified file abstraction supporting both buffered and streaming modes.
 *
 * Buffered mode (backed by Blob/File):
 * - All methods can be called multiple times
 * - size is always known
 *
 * Streaming mode (backed by ReadableStream):
 * - stream() returns the stream (one-time use, then consumed)
 * - blob()/buffer()/text() will buffer first, then switch to buffered mode
 * - size may be known (from HTTP headers, file stat) or undefined
 *
 * The framework automatically optimizes:
 * - Pass-through (forward to another service) → streams without buffering
 * - Read content (process file) → buffers only when needed
 */
export class GGFile {
    private _source: Blob | ReadableStream<Uint8Array> | null;
    private readonly _knownSize: number | undefined;
    readonly name: string;
    readonly mimeType: string;

    private constructor(
        source: Blob | ReadableStream<Uint8Array>,
        name: string,
        mimeType: string,
        size?: number
    ) {
        this._source = source;
        this._knownSize = size;
        this.name = name;
        this.mimeType = mimeType;
    }

    /**
     * File size in bytes.
     *
     * - Buffered: always known (from Blob.size)
     * - Streaming with known size: from constructor (HTTP header, file stat)
     * - Streaming with unknown size: undefined until buffered
     */
    get size(): number | undefined {
        if (this._knownSize !== undefined) return this._knownSize;
        if (this._source instanceof Blob) return this._source.size;
        return undefined;
    }

    /**
     * Whether this file is backed by a buffered source (Blob/File).
     * Buffered files can be read multiple times.
     */
    get isBuffered(): boolean {
        return this._source instanceof Blob;
    }

    /**
     * Whether this file's stream has been consumed.
     * Only true for streaming sources after stream() is called without buffering.
     */
    get isConsumed(): boolean {
        return this._source === null;
    }

    /**
     * Get the file as a ReadableStream.
     *
     * - Buffered: can be called multiple times (creates new stream from Blob)
     * - Streaming: can only be called once (returns and consumes the stream)
     *
     * Use this for pass-through scenarios (e.g., forwarding to S3).
     */
    stream(): ReadableStream<Uint8Array> {
        this.assertNotConsumed();

        if (this._source instanceof Blob) {
            return this._source.stream();
        }

        // Streaming source - hand it off and mark consumed
        const stream = this._source;
        this._source = null;
        return stream;
    }

    /**
     * Get the file as a Blob.
     *
     * - Buffered: returns immediately
     * - Streaming: buffers entire stream first, then switches to buffered mode
     *
     * After calling this on a streaming source, the file becomes buffered
     * and can be read multiple times.
     */
    async blob(): Promise<Blob> {
        this.assertNotConsumed();

        if (this._source instanceof Blob) {
            return this._source;
        }

        // Buffer the stream into a Blob
        const response = new Response(this._source);
        const blob = await response.blob();

        // Re-wrap with correct MIME type if needed
        this._source = blob.type === this.mimeType
            ? blob
            : new Blob([blob], { type: this.mimeType });

        return this._source;
    }

    /**
     * Get the file content as a Uint8Array.
     * Buffers streaming sources first.
     */
    async buffer(): Promise<Uint8Array> {
        const blob = await this.blob();
        return new Uint8Array(await blob.arrayBuffer());
    }

    /**
     * Get the file content as a UTF-8 string.
     * Buffers streaming sources first.
     */
    async text(): Promise<string> {
        const blob = await this.blob();
        return blob.text();
    }

    private assertNotConsumed(): void {
        if (this._source === null) {
            throw new Error(`GGFile "${this.name}" has been consumed. Streaming files can only be read once.`);
        }
    }

    // ==================== Static Factories ====================

    /**
     * Create a buffered GGFile from a native File.
     * Preferred for browser file inputs.
     */
    static fromFile(file: File): GGFile {
        return new GGFile(file, file.name, file.type || 'application/octet-stream');
    }

    /**
     * Create a buffered GGFile from a Blob.
     */
    static fromBlob(blob: Blob, name: string, mimeType?: string): GGFile {
        const type = mimeType ?? blob.type ?? 'application/octet-stream';
        const source = blob.type === type ? blob : new Blob([blob], { type });
        return new GGFile(source, name, type);
    }

    /**
     * Create a buffered GGFile from a Uint8Array.
     */
    static fromBuffer(data: Uint8Array, name: string, mimeType: string = 'application/octet-stream'): GGFile {
        const blob = new Blob([data], { type: mimeType });
        return new GGFile(blob, name, mimeType);
    }

    /**
     * Create a buffered GGFile from a string (UTF-8 encoded).
     */
    static fromString(content: string, name: string, mimeType: string = 'text/plain'): GGFile {
        const blob = new Blob([content], { type: mimeType });
        return new GGFile(blob, name, mimeType);
    }

    /**
     * Create a streaming GGFile from a ReadableStream.
     *
     * @param stream - The readable stream source
     * @param name - Filename
     * @param mimeType - MIME type
     * @param size - Optional size in bytes (from HTTP Content-Length, file stat, etc.)
     *
     * The resulting file can only be read once unless blob() is called first
     * to buffer it.
     */
    static fromStream(
        stream: ReadableStream<Uint8Array>,
        name: string,
        mimeType: string = 'application/octet-stream',
        size?: number
    ): GGFile {
        return new GGFile(stream, name, mimeType, size);
    }

    /**
     * Type guard to check if a value is a GGFile.
     */
    static is(value: unknown): value is GGFile {
        return value instanceof GGFile;
    }
}
```

### IsFile Schema

```typescript
// packages/schema/file/src/IsFile.ts

import { GGSchema, GGSchemaDefinition } from "@grest-ts/schema";
import { GGFile } from "./GGFile";

export interface FileDef extends GGSchemaDefinition {
    readonly type: 'file';
    readonly hasNonJsonData: true;  // Always true for files
    readonly accept?: readonly string[];
    readonly maxSize?: number;
}

export class FileSchema<T extends GGFile | undefined | null = GGFile> extends GGSchema<T, FileDef> {

    constructor(def: Omit<FileDef, 'type' | 'hasNonJsonData'> & { type?: 'file' }) {
        const { accept, maxSize } = def;

        const is = (value: unknown): value is GGFile => {
            if (!GGFile.is(value)) return false;

            // Check MIME type constraints
            if (accept && accept.length > 0) {
                const matches = accept.some(pattern => {
                    if (pattern === '*/*') return true;
                    if (pattern === value.mimeType) return true;
                    if (pattern.endsWith('/*')) {
                        return value.mimeType.startsWith(pattern.slice(0, -1));
                    }
                    return false;
                });
                if (!matches) return false;
            }

            // Check size constraint (only if size is known)
            if (maxSize !== undefined && value.size !== undefined) {
                if (value.size > maxSize) return false;
            }

            return true;
        };

        super({
            ...def,
            type: 'file',
            hasNonJsonData: true,
            is
        } as FileDef);
    }

    // ==================== Schema Derivation ====================

    accept(...types: string[]): FileSchema<T> {
        const combined = this.def.accept ? [...this.def.accept, ...types] : types;
        return this.derive({ accept: combined });
    }

    maxSize(bytes: number): FileSchema<T> {
        return this.derive({ maxSize: bytes });
    }

    get orUndefined(): FileSchema<T | undefined> {
        return super.orUndefined as FileSchema<T | undefined>;
    }

    get orNull(): FileSchema<T | null> {
        return super.orNull as FileSchema<T | null>;
    }

    protected derive<NewT extends GGFile | undefined | null = T>(
        changes: Partial<FileDef>
    ): FileSchema<NewT> {
        return new FileSchema<NewT>({
            accept: changes.accept ?? this.def.accept,
            maxSize: changes.maxSize ?? this.def.maxSize,
            optional: changes.optional ?? this.def.optional,
            nullable: changes.nullable ?? this.def.nullable
        });
    }

    // ==================== Static Shortcuts ====================

    static image(opts?: { maxSize?: number }): FileSchema {
        return new FileSchema({ accept: ['image/*'], maxSize: opts?.maxSize });
    }

    static pdf(opts?: { maxSize?: number }): FileSchema {
        return new FileSchema({ accept: ['application/pdf'], maxSize: opts?.maxSize });
    }

    static video(opts?: { maxSize?: number }): FileSchema {
        return new FileSchema({ accept: ['video/*'], maxSize: opts?.maxSize });
    }

    static audio(opts?: { maxSize?: number }): FileSchema {
        return new FileSchema({ accept: ['audio/*'], maxSize: opts?.maxSize });
    }

    static any(opts?: { maxSize?: number }): FileSchema {
        return new FileSchema({ maxSize: opts?.maxSize });
    }
}

export const IsFile = new FileSchema({});
```

### Wire Layer (Schema-Aware Serialization)

The Wire layer is schema-aware and AOT-optimized. It knows exactly where files are in the data structure.

```typescript
// packages/schema/schema/src/wire/SchemaWire.ts

/**
 * Wire format for data containing files.
 * Used for HTTP multipart transport.
 */
export interface WireFormat {
    /** JSON string with file indices where files were */
    readonly json: string;
    /** Extracted files in order */
    readonly files: WireFile[];
}

export interface WireFile {
    /** Index in the files array (matches placeholder in JSON) */
    readonly index: number;
    /** The file data - Blob for buffered, ReadableStream for streaming */
    readonly data: Blob | ReadableStream<Uint8Array>;
    /** Filename */
    readonly name: string;
    /** MIME type */
    readonly mimeType: string;
    /** Size if known */
    readonly size?: number;
}

/**
 * Input format when receiving wire data.
 */
export interface WireInput {
    /** Parsed JSON with file indices */
    readonly json: unknown;
    /** Received files keyed by index */
    readonly files: Map<number, WireFile>;
}
```

#### AOT-Compiled Wire Operations

```typescript
// Generated by AOT compiler for a schema like:
// IsObject({ avatar: IsFile, documents: IsArray(IsFile), name: IsString })

// toWire: Extract files, replace with indices
function toWire_UserInput(data: UserInput): WireFormat {
    const files: WireFile[] = [];

    const json = JSON.stringify({
        avatar: extractFile(data.avatar, files),
        documents: data.documents.map(f => extractFile(f, files)),
        name: data.name
    });

    return { json, files };
}

function extractFile(file: GGFile, files: WireFile[]): number {
    const index = files.length;
    files.push({
        index,
        data: file.isBuffered ? file.blob() : file.stream(),
        name: file.name,
        mimeType: file.mimeType,
        size: file.size
    });
    return index;
}

// fromWire: Inject files at known locations
function fromWire_UserInput(wire: WireInput): UserInput {
    const data = wire.json as any;

    return {
        avatar: injectFile(data.avatar, wire.files),
        documents: data.documents.map((idx: number) => injectFile(idx, wire.files)),
        name: data.name
    };
}

function injectFile(index: number, files: Map<number, WireFile>): GGFile {
    const wf = files.get(index)!;
    if (wf.data instanceof Blob) {
        return GGFile.fromBlob(wf.data, wf.name, wf.mimeType);
    } else {
        return GGFile.fromStream(wf.data, wf.name, wf.mimeType, wf.size);
    }
}
```

### HTTP Transport

#### Multipart Format (Simplified)

```
Content-Type: multipart/form-data; boundary=----boundary

------boundary
Content-Disposition: form-data; name="json"

{"avatar":0,"documents":[1,2],"name":"John"}
------boundary
Content-Disposition: form-data; name="0"; filename="avatar.jpg"
Content-Type: image/jpeg

<binary data>
------boundary
Content-Disposition: form-data; name="1"; filename="doc1.pdf"
Content-Type: application/pdf

<binary data>
------boundary--
```

- `json` field contains the data with file indices
- Numbered fields contain the actual files
- Simple, no separate `map` field needed

#### Client (Outgoing)

```typescript
// packages/http/http/src/client/GGHttpClient.ts

async send(methodName: keyof TContract, data: any): Promise<any> {
    const schema = this.schema.contract.methods[methodName]?.input;

    if (schema?.def.hasNonJsonData) {
        // Use AOT-compiled wire serialization
        const wire = schema.toWire(data);
        return this.sendMultipart(wire);
    } else {
        return this.sendJson(data);
    }
}

private async sendMultipart(wire: WireFormat): Promise<any> {
    const formData = new FormData();
    formData.append('json', wire.json);

    for (const file of wire.files) {
        if (file.data instanceof Blob) {
            formData.append(String(file.index), file.data, file.name);
        } else {
            // Streaming - need to buffer for FormData in browser
            // In Node.js with form-data package, could stream directly
            const blob = await new Response(file.data).blob();
            formData.append(String(file.index), blob, file.name);
        }
    }

    return fetch(url, { method: 'POST', body: formData });
}
```

#### Server (Incoming)

```typescript
// packages/http/http-server/http-server-fastify/src/GGHttpServerFastify.ts

// After parsing multipart with busboy/fastify-multipart:
private handleMultipart(
    jsonField: string,
    files: Map<number, { stream: ReadableStream, name: string, mimeType: string, size?: number }>
): WireInput {
    const json = JSON.parse(jsonField);

    const wireFiles = new Map<number, WireFile>();
    for (const [index, file] of files) {
        wireFiles.set(index, {
            index,
            data: file.stream,  // Keep as stream for pass-through
            name: file.name,
            mimeType: file.mimeType,
            size: file.size
        });
    }

    return { json, files: wireFiles };
}

// In route handler:
const wire = this.handleMultipart(jsonField, parsedFiles);
const data = schema.fromWire(wire);  // AOT-compiled injection
const result = await handler(data);
```

### Real-World Example: S3 Pass-Through

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

// API Definition
const UploadVideoApi = httpSchema({
    uploadVideo: {
        input: IsObject({
            video: IsFile.maxSize(1024 * 1024 * 1024),  // 1GB max
            title: IsString
        }),
        output: IsObject({ videoId: IsString })
    }
});

// Service Implementation
class VideoService {
    async uploadVideo(input: { video: GGFile, title: string }) {
        const videoId = generateId();

        // Stream directly to S3 - video never fully in memory!
        const upload = new Upload({
            client: new S3Client({ region: 'us-east-1' }),
            params: {
                Bucket: 'my-videos',
                Key: `${videoId}.mp4`,
                Body: input.video.stream(),  // Pass the stream
                ContentType: input.video.mimeType,
                ContentLength: input.video.size  // From HTTP headers
            }
        });

        await upload.done();

        return { videoId };
    }
}

// Memory usage for 1GB video: ~5-10MB (S3 multipart chunk size)
```

### Schema Package Changes

#### Remove from Definition.ts

```typescript
// DELETE these interfaces - no longer needed
// - GGSchemaBinaryData
// - GGSchemaNonJsonDefinition
// - isNonJsonDef function

// KEEP hasNonJsonData flag - still used to detect if wire encoding needed
```

#### Add Wire Operations to Schema

```typescript
// packages/schema/schema/src/GGSchema.ts

export abstract class GGSchema<T, Def extends GGSchemaDefinition> {
    // ... existing methods ...

    /**
     * Convert domain data to wire format.
     * AOT-optimized: O(k) where k = number of file fields.
     */
    toWire(value: T): WireFormat {
        return this._toWire(value);
    }

    /**
     * Convert wire format back to domain data.
     * AOT-optimized: O(k) where k = number of file fields.
     */
    fromWire(wire: WireInput): T {
        return this._fromWire(wire);
    }

    // These are set by AOT compiler or have default runtime implementation
    protected _toWire: (value: T) => WireFormat;
    protected _fromWire: (wire: WireInput) => T;
}
```

### Package Changes Summary

#### @grest-ts/file (rewrite)

- `src/GGFile.ts` - New unified implementation
- `src/IsFile.ts` - Simplified schema
- `testkit/GGTestFile.ts` - Update to new API

#### @grest-ts/schema (update)

- `src/Definition.ts` - Remove old binary data interfaces
- `src/GGSchema.ts` - Add toWire/fromWire methods
- `src/wire/` - New wire format types
- `src/executor/aot/` - AOT compilation for wire operations

#### @grest-ts/http (update)

- `src/client/GGHttpClient.ts` - Use schema.toWire()

#### @grest-ts/http-server-fastify (update)

- `src/GGHttpServerFastify.ts` - Use schema.fromWire()

#### @grest-ts/http-multipart (delete)

- No longer needed - wire layer handles this

#### @grest-ts/http-server-gg (delete or keep)

- Decide whether to keep custom server or use Fastify only

## Implementation Order

1. **GGFile** - New unified class
2. **IsFile** - Simplified schema with hasNonJsonData
3. **Wire types** - WireFormat, WireFile, WireInput interfaces
4. **Wire runtime** - Default toWire/fromWire implementation (non-AOT)
5. **HTTP client** - Use schema.toWire() for multipart
6. **HTTP server** - Use schema.fromWire() for multipart
7. **AOT wire** - Compile optimized toWire/fromWire
8. **Delete http-multipart** - No longer needed
9. **Tests** - Verify file upload tests pass
10. **Delete http-server-gg** - If decided

## Environment Support

| Feature | Browser | Node.js 20+ |
|---------|---------|-------------|
| `Blob` | Native | Native (global) |
| `File` | Native | Native (global) |
| `ReadableStream` | Native | Native (global) |
| `FormData` | Native | Native (global) |
| Streaming FormData | Buffer to Blob | Can use form-data pkg |

## Testing

Existing tests in `examples/grest-test/test/file-upload.test.ts` should work with minimal changes.

Additional tests:
- Streaming GGFile pass-through (mock S3)
- Buffered vs streaming behavior
- Consumed state errors
- Wire format round-trip
- AOT vs runtime wire operations
