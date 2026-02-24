import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const phoneCountryError = new GGIssueInvalid("phone.countryCode", "Phone must start with + and country code");
const phoneLengthError = new GGIssueInvalid("phone.length", "Phone length must be 8-15 characters");
const phoneFormatError = new GGIssueInvalid("phone.format", "Phone must contain only digits after +");
export const IsPhone = Object.assign(
    IsString
        .refine(v => v.startsWith('+'), phoneCountryError)
        .refine(v => v.length >= 8 && v.length <= 15, phoneLengthError)
        .refine(v => /^\d+$/.test(v.slice(1)), phoneFormatError)
        .brand("phone")
        .docs({
            title: "Phone number",
            description: "International format with country code",
            example: "+12025551234"
        }),
    {countryCodeError: phoneCountryError, lengthError: phoneLengthError, formatError: phoneFormatError}
);
export type tPhone = typeof IsPhone.infer;
