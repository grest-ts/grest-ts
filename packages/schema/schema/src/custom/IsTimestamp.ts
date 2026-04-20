import {IsInt} from "./IsInt";

export const IsTimestamp = IsInt.range(0, 32503680000).brand("timestamp").docs({
    title: "Unix timestamp in seconds",
    description: "Seconds since Unix epoch (year 1970–3000)",
    example: 1700000000
});
export type tTimestamp = typeof IsTimestamp.infer;

export const IsTimestampMs = IsInt.range(0, 32503680000000).brand("timestampMs").docs({
    title: "Unix timestamp in milliseconds",
    description: "Milliseconds since Unix epoch (year 1970–3000)",
    example: 1700000000000
});
export type tTimestampMs = typeof IsTimestampMs.infer;