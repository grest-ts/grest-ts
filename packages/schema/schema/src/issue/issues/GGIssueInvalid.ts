import {GGIssueKey} from "../GGIssueKey";

/** Maps param keys to string descriptions */
type ParamDescriptions<T> = { [K in keyof T]: string };

/**
 * Validation issue for invalid values (adds "invalid." prefix to code).
 * @template TParams - Object type for template parameters
 */
export class GGIssueInvalid<TParams extends object = {}> extends GGIssueKey<TParams> {

    constructor(
        code: string,
        message: string,
        ...paramDescriptions: keyof TParams extends never ? [] : [params: ParamDescriptions<TParams>]
    ) {
        super("invalid." + code, message, ...paramDescriptions as any);
    }

}