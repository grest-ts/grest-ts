// Email (RFC 5322 simplified - HTML5 email pattern)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const emailError = new GGIssueInvalid("email", "Invalid email format");

// HTML5 email validation regex - well-tested and widely used
// Handles most real-world email addresses while rejecting clearly invalid ones
// - Local part: alphanumeric + special chars, no consecutive dots, no leading/trailing dots
// - Domain: alphanumeric, hyphens allowed (not at start/end), proper TLD required
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const isValidEmail = (v: string): boolean => {
    // Length limits (RFC 5321)
    if (v.length > 254) return false;
    const atIndex = v.indexOf('@');
    if (atIndex > 64) return false; // Local part max 64 chars

    // Check for consecutive dots in local part
    const localPart = v.substring(0, atIndex);
    if (localPart.includes('..')) return false;
    if (localPart.startsWith('.') || localPart.endsWith('.')) return false;

    return EMAIL_REGEX.test(v);
};

export const IsEmail = Object.assign(
    IsString
        .refine(isValidEmail, emailError)
        .brand("email")
        .docs({
            title: "Email address",
            example: "user@example.com"
        }),
    {emailError}
);
export type tEmail = typeof IsEmail.infer;