import type http from "http";
import {ERROR, GGContractExecutor, GGContractMethod, GGErrorData, GGSchemaNonJsonDefinition, OK, isNonJsonDef} from "@grest-ts/schema";
import {ClientHttpRouteToRpcTransformServerConfig, applyResponseMiddleware} from "@grest-ts/http";
import type {GGTransportMiddleware} from "@grest-ts/context";

export class GGFileDownloadResponseBuilder {

    protected readonly contract: GGContractMethod
    private readonly middlewares: readonly GGTransportMiddleware[]
    private readonly encodeToRaw: GGSchemaNonJsonDefinition["encodeToRaw"]

    constructor(config: ClientHttpRouteToRpcTransformServerConfig) {
        this.contract = config.contract;
        this.middlewares = config.middlewares;
        const def = this.contract.success!.toCompilerDef();
        if (!isNonJsonDef(def)) {
            throw new Error("GGFileDownloadResponseBuilder: output schema must be a non-JSON leaf type (e.g. IsFile).");
        }
        this.encodeToRaw = def.encodeToRaw.bind(def);
    }

    public sendResponse = async (res: http.ServerResponse, rpcResult: ERROR<string, unknown> | OK<unknown>): Promise<void> => {
        applyResponseMiddleware(res, this.middlewares);
        if (rpcResult.success === true) {
            const raw = await this.encodeToRaw(rpcResult.data, "");
            const buffer = Buffer.from(await raw.blob.arrayBuffer());
            const headers: Record<string, string | number> = {
                'Content-Type': raw.blob.type || 'application/octet-stream',
                'Content-Length': buffer.length
            };
            if (raw.filename) {
                headers['Content-Disposition'] = `attachment; filename=${encodeURIComponent(raw.filename)}`;
            }
            res.writeHead(200, headers);
            res.end(buffer);
        } else {
            const json = this.makeError(rpcResult);
            res.writeHead(rpcResult.statusCode, {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(json)
            });
            res.end(json);
        }
    }

    private makeError(rpcResult: ERROR<string, unknown>): string {
        const schema = GGContractExecutor.getResponseSchema(this.contract, rpcResult);
        return '{' +
            '"success":false,' +
            '"type":' + JSON.stringify(rpcResult.type) + ',' +
            '"statusCode":' + Number(rpcResult.statusCode) +
            this.makeErrorCtx(rpcResult.context) +
            this.makeDataStr(schema, rpcResult) +
            "}";
    }

    private makeDataStr(schema: any, data: any): string {
        if (schema) {
            GGContractExecutor.assertResponse(schema, data);
            const dataStr = schema.unsafeStringify(data.data);
            return dataStr ? ',"data":' + dataStr : "";
        }
        return "";
    }

    private makeErrorCtx(ctx: GGErrorData | undefined): string {
        if (ctx) {
            let str = "";
            str += ctx.displayMessage ? '"displayMessage":' + JSON.stringify(ctx.displayMessage) : "";
            str += ctx.timestamp ? (str ? "," : "") + '"timestamp":' + Number(ctx.timestamp) : "";
            str += ctx.ref ? (str ? "," : "") + '"ref":' + JSON.stringify(ctx.ref) : "";
            if (str) {
                return ',"context":{' + str + '}';
            }
        }
        return "";
    }
}
