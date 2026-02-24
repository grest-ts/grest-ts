import {GGIssueInvalid} from "./issue/issues/GGIssueInvalid";
import {GGRangeIssue} from "./issue/issues/GGRangeIssue";

export const IsStringErrors = {
    typeError: new GGIssueInvalid("string.type", "Value must be a string"),
    nonEmptyError: new GGIssueInvalid("string.nonEmpty", "Value must not be empty"),
    minLengthError: new GGIssueInvalid<{ min: number }>("string.minLength", "Value must be at least {min} characters", {min: "Minimum length"}),
    maxLengthError: new GGIssueInvalid<{ max: number }>("string.maxLength", "Value must be at most {max} characters", {max: "Maximum length"}),
    rangeError: new GGRangeIssue("string.range", "Value must be between {min} and {max} characters"),
    patternError: new GGIssueInvalid("string.pattern", "Value does not match required pattern"),
} as const;

export const IsNumberErrors = {
    typeError: new GGIssueInvalid("number.type", "Value must be a number"),
    integerError: new GGIssueInvalid("number.integer", "Value must be an integer"),
    minError: new GGIssueInvalid<{ min: number }>("number.min", "Value must be at least {min}", {min: "Minimum value"}),
    maxError: new GGIssueInvalid<{ max: number }>("number.max", "Value must be at most {max}", {max: "Maximum value"}),
    rangeError: new GGRangeIssue("number.range", "Value must be between {min} and {max}"),
    multipleOfError: new GGIssueInvalid<{ multipleOf: number }>("number.multipleOf", "Value must be a multiple of {multipleOf}", {multipleOf: "Multiple of"}),
} as const;

export const IsBooleanErrors = {
    typeError: new GGIssueInvalid("boolean.type", "Value must be a boolean"),
} as const;

export const IsBitErrors = {
    typeError: new GGIssueInvalid("bit.type", "Value must be 0 or 1"),
} as const;

export const IsLiteralErrors = {
    invalidError: new GGIssueInvalid<{ expected: string }>("literal.invalid", "Value must be one of: {expected}", {expected: "Expected values"}),
} as const;

export const IsObjectErrors = {
    typeError: new GGIssueInvalid("object.type", "Value must be an object"),
} as const;

export const IsArrayErrors = {
    typeError: new GGIssueInvalid("array.type", "Value must be an array"),
    minLengthError: new GGIssueInvalid<{ min: number }>("array.minLength", "Array must have at least {min} items", {min: "Minimum length"}),
    maxLengthError: new GGIssueInvalid<{ max: number }>("array.maxLength", "Array must have at most {max} items", {max: "Maximum length"}),
    rangeError: new GGRangeIssue("array.range", "Array length must be between {min} and {max}"),
} as const;

export const IsTupleErrors = {
    typeError: new GGIssueInvalid("tuple.type", "Value must be an array"),
    lengthError: new GGIssueInvalid<{ expected: number, actual: number }>("tuple.length", "Expected {expected} elements, got {actual}", {expected: "Expected length", actual: "Actual length"}),
} as const;

export const IsRecordErrors = {
    typeError: new GGIssueInvalid("record.type", "Value must be an object"),
} as const;

export const IsUnionErrors = {
    unionError: new GGIssueInvalid("union.invalid", "Value does not match any variant"),
} as const;

export const IsDiscriminatedErrors = {
    notObjectError: new GGIssueInvalid("dunion.notObject", "Value must be an object"),
    missingDiscriminatorError: new GGIssueInvalid<{ field: string }>("dunion.missingDiscriminator", "Missing discriminator field '{field}'", {field: "Discriminator field"}),
    unknownVariantError: new GGIssueInvalid<{ field: string, value: string }>("dunion.unknownVariant", "Unknown variant '{value}' for discriminator '{field}'", {field: "Discriminator field", value: "Discriminator value"}),
} as const;