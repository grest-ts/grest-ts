import type http from "http";
import {ANY_ERROR, ERROR, GGContractExecutor, GGContractMethod, GGDebugData, GGErrorData, GGSchema, OK} from "@grest-ts/schema";
import type {GGTransportMiddleware} from "@grest-ts/context";
import {ClientHttpRouteToRpcTransformServerConfig} from "../../schema/GGHttpSchema";
import {applyResponseMiddleware} from "../../server/applyResponseMiddleware";


export class GGRpcResponseBuilder {

    protected readonly contract: GGContractMethod
    private readonly middlewares: readonly GGTransportMiddleware[]

    constructor(config: ClientHttpRouteToRpcTransformServerConfig) {
        this.contract = config.contract;
        this.middlewares = config.middlewares;
    }

    public sendResponse = async (res: http.ServerResponse, rpcResult: ERROR<string, unknown> | OK<unknown>): Promise<void> => {
        let json: string;
        let statusCode: number;
        if (rpcResult.success === true) {
            statusCode = 200;
            json = '{' +
                '"success":true,' +
                '"type":"OK"' +
                this.makeDataStr(this.contract.success, rpcResult) +
                "}"
        } else {
            json = this.makeError(GGContractExecutor.getResponseSchema(this.contract, rpcResult), rpcResult);
            statusCode = rpcResult.statusCode;
        }
        applyResponseMiddleware(res, this.middlewares);
        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(json)
        });
        res.end(json)
    }

    private makeError(schema: GGSchema<any> | undefined, rpcResult: ERROR<string, unknown>) {
        return '{' +
            '"success":false,' +
            '"type":' + JSON.stringify(rpcResult.type) + ',' +
            '"statusCode":' + Number(rpcResult.statusCode) +
            this.makeErrorCtx(rpcResult.context, rpcResult.getDebugContext()) +
            this.makeDataStr(schema, rpcResult) +
            "}";
    }

    private makeDataStr(schema: GGSchema<any>, data: OK<any> | ANY_ERROR): string {
        if (schema) {
            GGContractExecutor.assertResponse(schema, data);
            const dataStr = schema.unsafeStringify(data.data)
            return dataStr ? ',"data":' + dataStr + "" : "";
        } else {
            return "";
        }
    }

    private makeErrorCtx(ctx: GGErrorData, debugContext?: GGDebugData): string {
        if (ctx) {
            let str = "";
            str += ctx?.displayMessage ? '"displayMessage":' + JSON.stringify(ctx.displayMessage) + '' : "";
            str += ctx?.timestamp ? (str ? "," : "") + '"timestamp":' + Number(ctx.timestamp) : "";
            str += ctx?.ref ? (str ? "," : "") + '"ref":' + JSON.stringify(ctx.ref) + '' : "";
            if (process.env.NODE_ENV !== "production" && debugContext) {
                if (debugContext?.debugMessage) {
                    str += (str ? "," : "") + '"debugMessage":' + JSON.stringify(debugContext.debugMessage);
                }
                if (debugContext?.debugData !== undefined) {
                    str += (str ? "," : "") + '"debugData":' + JSON.stringify(debugContext.debugData);
                }
                if (debugContext?.originalError) {
                    const origErr = debugContext.originalError;
                    const errInfo = origErr instanceof ERROR
                        ? origErr.toJSON()
                        : origErr instanceof Error
                            ? {message: origErr.message, stack: origErr.stack?.split("\n")}
                            : {message: String(origErr)};
                    str += (str ? "," : "") + '"originalError":' + JSON.stringify(errInfo);
                }
            }
            if (str) {
                return ',"context":{' + str + '}';
            }
        }
        return "";
    }
}
