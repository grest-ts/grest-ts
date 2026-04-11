import {GGSchema, GGSchemaNonJsonDefinition, GGSchemaBinaryData, GGIssueInvalid, Opt} from "@grest-ts/schema";
import type {GGIssuesList} from "@grest-ts/schema";
import type {OpenAPIV3_1} from "openapi-types";
import {BufferGGFile, GGFile} from "./GGFile";

/**
 * Definition for file schema.
 */
export interface FileDef extends GGSchemaNonJsonDefinition {
    readonly type: 'file';
    readonly accept?: readonly string[];
    readonly maxSize?: number;
}

// ==================== Helper Functions ====================

function isGGFileLike(value: unknown): value is GGFile {
    return typeof value === 'object'
        && value !== null
        && 'name' in value
        && 'mimeType' in value
        && 'size' in value
        && typeof (value as any).name === 'string'
        && typeof (value as any).mimeType === 'string'
        && typeof (value as any).size === 'number';
}

function matchesAccept(name: string, mimeType: string, accept?: readonly string[]): boolean {
    if (!accept || accept.length === 0) return true;
    for (const pattern of accept) {
        if (pattern.startsWith('.')) {
            if (name.toLowerCase().endsWith(pattern.toLowerCase())) return true;
        } else if (pattern === '*/*') {
            return true;
        } else if (pattern.endsWith('/*')) {
            if (mimeType.startsWith(pattern.slice(0, -1))) return true;
        } else {
            if (mimeType === pattern) return true;
        }
    }
    return false;
}

// ==================== FileSchema ====================

export class FileSchema<T extends GGFile | undefined | null = GGFile> extends GGSchema<T, FileDef> {

    public static readonly typeError = new GGIssueInvalid("file.type", "Value must be a file");
    public static readonly mimeTypeError = new GGIssueInvalid<{ accept: string }>("file.mimeType", "File type not accepted, expected: {accept}", {accept: "Accepted types"});
    public static readonly maxSizeError = new GGIssueInvalid<{ max: number }>("file.maxSize", "File exceeds maximum size of {max} bytes", {max: "Maximum size"});

    constructor(def: { type: 'file', accept?: readonly string[], maxSize?: number, optional?: boolean, nullable?: boolean }) {
        const {accept, maxSize} = def;

        const is = (value: unknown): value is GGFile => {
            if (!isGGFileLike(value)) return false;
            return matchesAccept(value.name, value.mimeType, accept) && (maxSize === undefined || value.size <= maxSize);
        };

        const isWithErrors = (value: unknown, issues: GGIssuesList, path: string): value is GGFile => {
            if (!isGGFileLike(value)) {
                return FileSchema.typeError.add(value, issues, path);
            }
            let valid = true;
            if (!matchesAccept(value.name, value.mimeType, accept)) {
                FileSchema.mimeTypeError.add(value, issues, path, {accept: accept?.join(', ') ?? '*/*'});
                valid = false;
            }
            if (maxSize !== undefined && value.size > maxSize) {
                FileSchema.maxSizeError.add(value, issues, path, {max: maxSize});
                valid = false;
            }
            return valid;
        };

        const encodeToRaw = async (value: unknown, path: string): Promise<GGSchemaBinaryData> => {
            const file = value as GGFile;
            const buffer = await file.clone().buffer();
            const blob = new Blob([buffer as unknown as Uint8Array<ArrayBuffer>], {type: file.mimeType});
            return {path, blob, filename: file.name};
        };

        const decodeFromRaw = async (raw: GGSchemaBinaryData): Promise<GGFile> => {
            const buffer = await raw.blob.arrayBuffer();
            return new BufferGGFile(new Uint8Array(buffer), raw.filename || 'file', raw.blob.type);
        };

        super({...def, hasNonJsonData: true, is, isWithErrors, encodeToRaw, decodeFromRaw} as FileDef);
    }

    // ==================== Schema Methods ====================

    get orUndefined(): FileSchema<T | undefined> & Opt {
        return super.orUndefined as any;
    }

    get orNull(): FileSchema<T | null> {
        return super.orNull as any;
    }

    protected derive<NewT extends GGFile | undefined | null = T>(changes: Partial<FileDef>): FileSchema<NewT> {
        if (this.def.maxSize !== undefined && changes.maxSize !== undefined && changes.maxSize > this.def.maxSize) {
            throw new Error(`Cannot raise maxSize from ${this.def.maxSize} to ${changes.maxSize}`);
        }
        return new FileSchema<NewT>({
            type: 'file',
            accept: changes.accept ?? this.def.accept,
            maxSize: changes.maxSize ?? this.def.maxSize,
            optional: changes.optional ?? this.def.optional,
            nullable: changes.nullable ?? this.def.nullable
        });
    }

    // ==================== File Constraints ====================

    protected _buildJsonSchema(): OpenAPIV3_1.SchemaObject {
        const schema: OpenAPIV3_1.NonArraySchemaObject = {type: 'string', format: 'binary'};
        if (this.def.accept?.length) schema.description = `Accepted types: ${this.def.accept.join(', ')}`;
        return schema;
    }

    accept(...types: string[]): FileSchema<T> {
        const combined = this.def.accept ? [...this.def.accept, ...types] : types;
        return this.derive({accept: combined});
    }

    maxSize(bytes: number): FileSchema<T> {
        return this.derive({maxSize: bytes});
    }

    // ==================== Static Shortcuts ====================

    static image(opts?: { maxSize?: number }): FileSchema {
        let s = new FileSchema({type: 'file', accept: ['image/*']});
        return opts?.maxSize ? s.maxSize(opts.maxSize) : s;
    }

    static pdf(opts?: { maxSize?: number }): FileSchema {
        let s = new FileSchema({type: 'file', accept: ['application/pdf']});
        return opts?.maxSize ? s.maxSize(opts.maxSize) : s;
    }

    static any(opts?: { maxSize?: number }): FileSchema {
        let s = new FileSchema({type: 'file'});
        return opts?.maxSize ? s.maxSize(opts.maxSize) : s;
    }

    static video(opts?: { maxSize?: number }): FileSchema {
        let s = new FileSchema({type: 'file', accept: ['video/*']});
        return opts?.maxSize ? s.maxSize(opts.maxSize) : s;
    }

    static audio(opts?: { maxSize?: number }): FileSchema {
        let s = new FileSchema({type: 'file', accept: ['audio/*']});
        return opts?.maxSize ? s.maxSize(opts.maxSize) : s;
    }
}

export const IsFile = new FileSchema({type: 'file'});
export type tFile = typeof IsFile.infer;
