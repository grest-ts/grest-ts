import {GGParseResult, GGValidator} from "./GGSchema";
import {Raw} from "./issue/types";
import {SERVER_ERROR} from "./contract/ERROR";

export class GGTransform<Input, Output> {

    public readonly inputSchema: GGValidator<Input>
    public readonly outputSchema: GGValidator<Output>
    private readonly _transform: (input: Input) => Raw<Output>

    constructor(
        inputSchema: GGValidator<Input>,
        outputSchema: GGValidator<Output>,
        transform: (input: Input) => Raw<Output>
    ) {
        this.inputSchema = inputSchema;
        this.outputSchema = outputSchema;
        this._transform = transform;
        Object.freeze(this);
    }

    public encode(data: Input): GGParseResult<Output> {
        const inputResult = this.inputSchema.safeParse(data);
        if (inputResult.success !== true) {
            return inputResult;
        }
        const transformed = this._transform(inputResult.value);
        const outputResult = this.outputSchema.safeParse(transformed);
        if (outputResult.success !== true) {
            throw new SERVER_ERROR({
                displayMessage: "Transform error!",
                debugMessage: "Transform output validation failed: transform produced invalid output. This is a coding error in the transform definition.",
                debugData: {
                    issues: outputResult.issues.toJSON()
                }
            });
        }
        return outputResult;
    }

    public transformTo<NewType>(to: GGTransform<Output, NewType>): GGTransform<Input, NewType> {
        return new GGTransform<Input, NewType>(this.inputSchema, to.outputSchema, (input: Input): Raw<NewType> => {
            const intermediate = this.encode(input);
            if (intermediate.success !== true) {
                throw new SERVER_ERROR({
                    displayMessage: "Transform error!",
                    debugMessage: "Chained transform failed at intermediate step.",
                    debugData: {issues: intermediate.issues.toJSON()}
                });
            }
            const result = to.encode(intermediate.value);
            if (result.success !== true) {
                throw new SERVER_ERROR({
                    displayMessage: "Transform error!",
                    debugMessage: "Chained transform failed at final step.",
                    debugData: {issues: result.issues.toJSON()}
                });
            }
            return result.value as Raw<NewType>;
        })
    }

}