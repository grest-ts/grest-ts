import type http from "http";
import type {HttpMethod} from "@grest-ts/common";
import {GGContractExecutor, GGContractMethod, GGSchemaBinaryData} from "@grest-ts/schema";
import {ClientHttpRouteToRpcTransformServerConfig, applyRequestMiddleware} from "@grest-ts/http";
import type {GGTransportMiddleware} from "@grest-ts/context";
import Busboy from "busboy";

type NonJsonDecoder = (raw: GGSchemaBinaryData) => Promise<unknown>;

export class GGFileUploadRequestParser {

    protected readonly contract: GGContractMethod
    private readonly middlewares: readonly GGTransportMiddleware[]
    private readonly decoderMap: Map<string, NonJsonDecoder>

    constructor(
        _method: HttpMethod,
        _pathTemplate: string,
        config: ClientHttpRouteToRpcTransformServerConfig
    ) {
        this.contract = config.contract
        this.middlewares = config.middlewares
        this.decoderMap = this.contract.input?.collectNonJsonDecoders() ?? new Map()
    }

    public parseRequest = async (req: http.IncomingMessage): Promise<unknown> => {
        const url = req.url || '/'
        const qIndex = url.indexOf('?')
        const queryArgs = this.parseQueryString(qIndex === -1 ? '' : url.substring(qIndex + 1))
        await applyRequestMiddleware(req, queryArgs, this.middlewares)

        const input = await this.parseMultipartBody(req);
        return GGContractExecutor.parseInput(this.contract.input, input);
    }

    private parseQueryString(rawQuery: string): Record<string, string | string[]> {
        const result: Record<string, string | string[]> = {}
        if (rawQuery) {
            const params = new URLSearchParams(rawQuery)
            for (const [key, value] of params.entries()) {
                result[key] = value
            }
        }
        return result;
    }

    private async parseMultipartBody(req: http.IncomingMessage): Promise<unknown> {
        const {jsonStr, files} = await this.parseBusboy(req);

        const parsed = jsonStr ? JSON.parse(jsonStr) : {};

        // Decode each binary part and set at its path in the parsed object
        const decodePromises: Promise<void>[] = [];
        for (const {fieldName, buffer, filename, mimeType} of files) {
            const decoder = this.findDecoder(fieldName);
            if (!decoder) continue;

            const blob = new Blob([new Uint8Array(buffer)], {type: mimeType});
            const raw: GGSchemaBinaryData = {path: fieldName, blob, filename};
            decodePromises.push(
                decoder(raw).then(value => {
                    setAtPath(parsed, fieldName, value);
                })
            );
        }
        await Promise.all(decodePromises);

        return parsed;
    }

    private findDecoder(fieldName: string): NonJsonDecoder | undefined {
        // Exact match first
        const exact = this.decoderMap.get(fieldName);
        if (exact) return exact;

        // Replace numeric segments with * for array element matching
        // e.g. "files.0" -> "files.*", "meta.docs.2" -> "meta.docs.*"
        const wildcardPath = fieldName.replace(/\.\d+/g, '.*');
        if (wildcardPath !== fieldName) {
            return this.decoderMap.get(wildcardPath);
        }
        return undefined;
    }

    private parseBusboy(req: http.IncomingMessage): Promise<{
        jsonStr: string | undefined,
        files: { fieldName: string, buffer: Buffer, filename: string, mimeType: string }[]
    }> {
        return new Promise((resolve, reject) => {
            let jsonStr: string | undefined;
            const files: { fieldName: string, buffer: Buffer, filename: string, mimeType: string }[] = [];

            const busboy = Busboy({headers: req.headers});

            busboy.on('field', (fieldName: string, value: string) => {
                if (fieldName === '__json') {
                    jsonStr = value;
                }
            });

            busboy.on('file', (fieldName: string, stream: NodeJS.ReadableStream, info: { filename: string, encoding: string, mimeType: string }) => {
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', () => {
                    // Busboy decodes filenames as Latin-1, but browsers send UTF-8.
                    // Re-decode from Latin-1 bytes back to UTF-8.
                    let filename = info.filename;
                    try {
                        const latin1 = Buffer.from(filename, 'latin1');
                        const utf8 = latin1.toString('utf-8');
                        if (utf8 !== filename) filename = utf8;
                    } catch {}
                    files.push({
                        fieldName,
                        buffer: Buffer.concat(chunks),
                        filename,
                        mimeType: info.mimeType
                    });
                });
            });

            busboy.on('finish', () => resolve({jsonStr, files}));
            busboy.on('error', reject);

            req.pipe(busboy);
        });
    }
}

// --------------------------------------------------------------------------------------------------------
// Path utility
// --------------------------------------------------------------------------------------------------------

function setAtPath(obj: any, path: string, value: unknown): void {
    const parts = path.split(".");
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const nextPart = parts[i + 1];
        if (current[part] === undefined || current[part] === null) {
            // Create array for numeric next parts, object otherwise
            current[part] = /^\d+$/.test(nextPart) ? [] : {};
        }
        current = current[part];
    }
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
}
