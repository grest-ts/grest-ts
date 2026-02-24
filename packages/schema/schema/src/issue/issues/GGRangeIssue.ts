import {GGIssueInvalid} from "./GGIssueInvalid";

/**
 * Validation issue for range violations with min/max metadata.
 * Always requires {min, max} params when adding.
 */
export class GGRangeIssue extends GGIssueInvalid<RangeParams> {

    constructor(code: string, message: string) {
        super(code, message, {
            min: "Minimum value",
            max: "Maximum value"
        });
    }
}

export interface RangeParams {
    min: number;
    max: number;
}