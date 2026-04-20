// Date (YYYY-MM-DD with validation)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const dateFormatError = new GGIssueInvalid("date.format", "Expected date format YYYY-MM-DD");
const dateInvalidError = new GGIssueInvalid("date.invalid", "Invalid date");
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Parse date parts explicitly to avoid timezone issues
const isValidDate = (v: string): boolean => {
    if (!DATE_REGEX.test(v)) return false;
    const [year, month, day] = v.split('-').map(Number);
    // Use UTC to avoid timezone shifts
    const date = new Date(Date.UTC(year, month - 1, day));
    // Validate the date components match (catches invalid dates like Feb 30)
    return date.getUTCFullYear() === year &&
           date.getUTCMonth() === month - 1 &&
           date.getUTCDate() === day;
};

export const IsDate = Object.assign(
    IsString
        .regex(DATE_REGEX, dateFormatError)
        .refine(isValidDate, dateInvalidError)
        .brand("date")
        .docs({
            title: "Date",
            format: "date",
            description: "Format YYYY-MM-DD",
            example: "2024-01-15"
        }),
    {formatError: dateFormatError, invalidError: dateInvalidError}
);
export type tDate = typeof IsDate.infer;