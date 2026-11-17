import {GGIssuesList} from "./GGIssuesList";

export class GGParseError extends Error {
    public override readonly name = "GGParseError"
    public readonly issues: GGIssuesList

    constructor(issues: GGIssuesList) {
        super(issues.toString())
        this.issues = issues
    }
}
