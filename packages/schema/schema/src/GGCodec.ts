import {GGParseResult, GGSchema} from "./GGSchema";
import {GGTransform} from "./GGTransform";
import type {ObjectDef} from "./Definition";

export interface GGCodecConfig<Input, Output> {
    encode: GGTransform<Input, Output>,
    decode: GGTransform<Output, Input>
}

export class GGCodec<Input, Output> {

    private readonly config: GGCodecConfig<Input, Output>

    constructor(config: GGCodecConfig<Input, Output>) {
        this.config = config;
        Object.freeze(this);
    }

    public encode(data: Input): GGParseResult<Output> {
        return this.config.encode.encode(data);
    }

    public decode(data: Output): GGParseResult<Input> {
        return this.config.decode.encode(data);
    }

    /**
     * Returns the keys of the encode transform's input schema, if it is an object schema.
     * Useful for introspecting which fields a codec reads from its input (e.g. header names).
     */
    public get inputKeys(): readonly string[] | undefined {
        const schema = this.config.encode.inputSchema;
        if (schema instanceof GGSchema && schema.toCompilerDef().type === 'object') {
            const shape = (schema.toCompilerDef() as ObjectDef).shape;
            if (shape) return Object.keys(shape);
        }
        return undefined;
    }

    public codecTo<Third>(other: GGCodec<Output, Third>): GGCodec<Input, Third> {
        return new GGCodec<Input, Third>({
            encode: this.config.encode.transformTo(other.config.encode),
            decode: other.config.decode.transformTo(this.config.decode)
        });
    }
}
