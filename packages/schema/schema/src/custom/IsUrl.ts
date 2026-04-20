// URL (using native URL constructor for robust validation)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const urlError = new GGIssueInvalid("url", "Invalid URL format");

// Use native URL constructor for robust URL validation
const isValidUrl = (v: string): boolean => {
    try {
        const url = new URL(v);
        // Only allow http and https protocols
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};

export const IsUrl = Object.assign(
    IsString
        .refine(isValidUrl, urlError)
        .brand("url")
        .docs({
            title: "URL",
            format: "uri",
            description: "HTTP or HTTPS URL",
            example: "https://example.com"
        }),
    {urlError}
);
export type tUrl = typeof IsUrl.infer;

