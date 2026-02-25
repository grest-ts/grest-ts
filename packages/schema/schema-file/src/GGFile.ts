/**
 * Unified file abstraction for Grest framework.
 * Works across HTTP (multipart), WebSocket (base64), and tests (in-memory).
 *
 * Single consumption: buffer()/stream()/text() can only be called once.
 * Use clone() if multiple reads are needed.
 */
export abstract class GGFile {
    abstract readonly name: string;
    abstract readonly mimeType: string;
    abstract readonly size: number;

    /**
     * Whether the file content has been consumed.
     * Once consumed, buffer()/stream()/text() will throw.
     */
    abstract readonly consumed: boolean;

    /**
     * Get the file content as a ReadableStream.
     * Can only be called once per file instance.
     * @throws Error if already consumed
     */
    abstract stream(): ReadableStream<Uint8Array>;

    /**
     * Get the file content as a Uint8Array.
     * Can only be called once per file instance.
     * @throws Error if already consumed
     */
    abstract buffer(): Promise<Uint8Array>;

    /**
     * Get the file content as a UTF-8 string.
     * Can only be called once per file instance.
     * @throws Error if already consumed
     */
    abstract text(): Promise<string>;

    /**
     * Create a copy of this file that can be consumed independently.
     * Only works if the file hasn't been consumed yet.
     * @throws Error if already consumed
     */
    abstract clone(): GGFile;

    // ==================== Static Factory Methods ====================

    /**
     * Create a GGFile from a Uint8Array buffer.
     */
    static fromBuffer(data: Uint8Array, name: string, mimeType: string = 'application/octet-stream'): GGFile {
        return new BufferGGFile(data, name, mimeType);
    }

    /**
     * Create a GGFile from a string (encoded as UTF-8).
     */
    static fromString(content: string, name: string, mimeType: string = 'text/plain'): GGFile {
        const encoder = new TextEncoder();
        return new BufferGGFile(encoder.encode(content), name, mimeType);
    }

    /**
     * Create a GGFile from a base64-encoded string.
     * Used for WebSocket transport where files are sent as base64.
     */
    static fromBase64(base64: string, name: string, mimeType: string = 'application/octet-stream'): GGFile {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return new BufferGGFile(bytes, name, mimeType);
    }

    /**
     * Convert a GGFile to base64 string.
     * Consumes the file.
     */
    static async toBase64(file: GGFile): Promise<string> {
        const buffer = await file.buffer();
        let binary = '';
        for (let i = 0; i < buffer.length; i++) {
            binary += String.fromCharCode(buffer[i]);
        }
        return btoa(binary);
    }

    /**
     * Serialize a GGFile to JSON format for WebSocket transport.
     * Consumes the file.
     */
    static async toJSON(file: GGFile): Promise<GGFileJSON> {
        return {
            __ggfile: true,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
            data: await GGFile.toBase64(file),
        };
    }

    /**
     * Deserialize a GGFile from JSON format.
     */
    static fromJSON(json: GGFileJSON): GGFile {
        if (!json.__ggfile) {
            throw new Error('Invalid GGFile JSON: missing __ggfile marker');
        }
        return GGFile.fromBase64(json.data, json.name, json.mimeType);
    }

    /**
     * Check if a value is a serialized GGFile JSON.
     */
    static isJSON(value: unknown): value is GGFileJSON {
        return typeof value === 'object'
            && value !== null
            && '__ggfile' in value
            && (value as GGFileJSON).__ggfile === true
            && 'name' in value
            && 'mimeType' in value
            && 'size' in value
            && 'data' in value;
    }

    /**
     * Create a GGFile from a native browser File.
     * Lazily reads the file content only when buffer()/stream()/text() is called.
     */
    static fromBrowserFile(file: File & { readonly name: string }): GGFile {
        return new BrowserGGFile(file);
    }
}

/**
 * JSON serialization format for GGFile (used in WebSocket transport).
 */
export interface GGFileJSON {
    __ggfile: true;
    name: string;
    mimeType: string;
    size: number;
    data: string;  // base64 encoded
}

/**
 * In-memory implementation of GGFile.
 * Used for tests and when file content is already fully buffered.
 */
export class BufferGGFile extends GGFile {
    private _consumed = false;
    private readonly data: Uint8Array;
    readonly name: string;
    readonly mimeType: string;

    constructor(data: Uint8Array, name: string, mimeType: string = 'application/octet-stream') {
        super();
        this.data = data;
        this.name = name;
        this.mimeType = mimeType;
    }

    get size(): number {
        return this.data.length;
    }

    get consumed(): boolean {
        return this._consumed;
    }

    protected assertNotConsumed(): void {
        if (this._consumed) {
            throw new Error(`GGFile "${this.name}" has already been consumed. Use clone() if multiple reads are needed.`);
        }
    }

    stream(): ReadableStream<Uint8Array> {
        this.assertNotConsumed();
        this._consumed = true;

        const data = this.data;
        return new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(data);
                controller.close();
            }
        });
    }

    async buffer(): Promise<Uint8Array> {
        this.assertNotConsumed();
        this._consumed = true;
        return this.data;
    }

    async text(): Promise<string> {
        this.assertNotConsumed();
        this._consumed = true;
        return new TextDecoder().decode(this.data);
    }

    clone(): GGFile {
        this.assertNotConsumed();
        return new BufferGGFile(new Uint8Array(this.data), this.name, this.mimeType);
    }
}

/**
 * Browser implementation of GGFile that wraps a native File/Blob.
 * Lazily reads file content only when buffer()/stream()/text() is called.
 */
export class BrowserGGFile extends GGFile {
    private _consumed = false;
    readonly name: string;
    readonly mimeType: string;
    readonly size: number;

    constructor(private readonly nativeFile: File & { readonly name: string }) {
        super();
        this.name = nativeFile.name;
        this.mimeType = nativeFile.type || 'application/octet-stream';
        this.size = nativeFile.size;
    }

    get consumed(): boolean {
        return this._consumed;
    }

    private assertNotConsumed(): void {
        if (this._consumed) {
            throw new Error(`GGFile "${this.name}" has already been consumed. Use clone() if multiple reads are needed.`);
        }
    }

    stream(): ReadableStream<Uint8Array> {
        this.assertNotConsumed();
        this._consumed = true;
        return this.nativeFile.stream() as ReadableStream<Uint8Array>;
    }

    async buffer(): Promise<Uint8Array> {
        this.assertNotConsumed();
        this._consumed = true;
        return new Uint8Array(await this.nativeFile.arrayBuffer());
    }

    async text(): Promise<string> {
        this.assertNotConsumed();
        this._consumed = true;
        return this.nativeFile.text();
    }

    clone(): GGFile {
        this.assertNotConsumed();
        return new BrowserGGFile(this.nativeFile);
    }
}