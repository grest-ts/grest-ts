import {ValidationIssueJson} from "@grest-ts/schema";

import {GG_INTL} from "./GG_INTL";

export function GGIntlTypeLocalizer(issue: ValidationIssueJson) {
    const intl = GG_INTL.tryGet();
    if (intl) {
        const locale = intl.getLocale();
        const {message, usedLanguage} = intl.tWithInfo(issue.code, issue.params, issue.message);
        issue.message = message;
        issue.usedLanguage = usedLanguage;
        issue.expectedLanguage = locale;
    }
}
