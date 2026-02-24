// DateTime (YYYY-MM-DD HH:mm:ss with validation)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const datetimeFormatError = new GGIssueInvalid("datetime.format", "Expected format YYYY-MM-DD HH:mm:ss");
const datetimeInvalidError = new GGIssueInvalid("datetime.invalid", "Invalid datetime");
const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const isValidDateTime = (v: string): boolean => {
    if (!DATETIME_REGEX.test(v)) return false;
    const [datePart, timePart] = v.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);
    // Use UTC to avoid timezone issues
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
        date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
};
export const IsDateTime = Object.assign(
    IsString
        .regex(DATETIME_REGEX, datetimeFormatError)
        .refine(isValidDateTime, datetimeInvalidError)
        .brand("datetime")
        .docs({
            title: "DateTime",
            description: "Format YYYY-MM-DD HH:mm:ss",
            example: "2024-01-15 14:30:00"
        }),
    {formatError: datetimeFormatError, invalidError: datetimeInvalidError}
);
export type tDateTime = typeof IsDateTime.infer;
