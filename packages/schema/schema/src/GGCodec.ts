import {GGParseResult} from "./GGSchema";
import {GGTransform} from "./GGTransform";

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

    public codecTo<Third>(other: GGCodec<Output, Third>): GGCodec<Input, Third> {
        return new GGCodec<Input, Third>({
            encode: this.config.encode.transformTo(other.config.encode),
            decode: other.config.decode.transformTo(this.config.decode)
        });
    }
}
