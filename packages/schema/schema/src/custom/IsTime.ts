// Time (HH:mm:ss 24-hour format)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const timeError = new GGIssueInvalid("time", "Expected time in HH:mm:ss format (24-hour)");
export const IsTime = Object.assign(
    IsString.regex(/^([0-1][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/, timeError).brand("time").docs({
        title: "Time",
        description: "24-hour format HH:mm:ss",
        example: "14:30:00"
    }),
    {timeError}
);
export type tTime = typeof IsTime.infer;