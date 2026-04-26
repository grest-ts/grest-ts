import {ERROR, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, VALIDATION_ERROR, SERVER_ERROR} from "@grest-ts/schema";

export const FORBIDDEN_BOOKKEEPING_LOCKED = ERROR.define("FORBIDDEN_BOOKKEEPING_LOCKED", 403)

export class ApiErrors {

    public static dbError<Tag extends string>(tag: Capitalize<Tag>, msg: string): never {
        throw new SERVER_ERROR({displayMessage: msg});
    }

    public static serverError<Tag extends string>(tag: Capitalize<Tag>, error: Error): never {
        throw new SERVER_ERROR({displayMessage: tag + ": " + (error?.message || "There was an unexpected error on the server side. Try again later.")});
    }

    public static unknownError<Tag extends string>(error: Error | unknown, tag: Capitalize<Tag> = "UnknownError" as Capitalize<Tag>): never {
        const msg = "There was an unexpected error on the server side. Try again later." + ((error as any)?.message ? "\n\n" + (error as any)?.message : "");
        throw new SERVER_ERROR({displayMessage: msg});
    }

    public static invalidRequest<Tag extends string>(tag: Capitalize<Tag>, error: string, data?: any): never {
        throw new VALIDATION_ERROR([{path: tag, code: "invalid_request", message: error}], {displayMessage: error});
    }

    public static validationError<T, Tag extends string>(entityThatHadError: Capitalize<Tag>, errors: ValidationErrorsType<T>): never {
        const issues = errors.errors
            ? Object.entries(errors.errors).map(([field, err]: [string, any]) => ({
                path: field || entityThatHadError,
                code: "validation_error",
                message: err?.msg || "Validation failed"
            }))
            : [{path: entityThatHadError, code: "validation_error", message: "Validation failed"}];
        throw new VALIDATION_ERROR(issues, {displayMessage: "Validation failed"});
    }

    public static notFound<Tag extends string>(entityThatWasNotFound: Capitalize<Tag>, msg?: string): never {
        throw new NOT_FOUND({displayMessage: msg || entityThatWasNotFound + " was not found!"});
    }

    public static alreadyExists<Tag extends string>(tag: Capitalize<Tag> = "AlreadyExists" as Capitalize<Tag>, msg: string = "Already exists"): never {
        throw new VALIDATION_ERROR([{path: tag, code: "already_exists", message: msg}], {displayMessage: "File already exists!"});
    }

    public static cantDelete<Tag extends string>(tag: Capitalize<Tag> = "CanNotDelete" as Capitalize<Tag>, msg: string = "Can not delete as it is related to some other objects. Delete those first."): never {
        throw new VALIDATION_ERROR([{path: tag, code: "cant_delete", message: msg}], {displayMessage: "Can't delete!"});
    }

    public static unreplacedVariables(variableNames: string[]): never {
        throw new VALIDATION_ERROR(
            variableNames.map(v => ({
                path: v,
                code: "unreplaced_variable",
                message: `Variable [$${v}] is not replaced. Please check your template.`
            })),
            {displayMessage: "Email template contains unreplaced variables"}
        );
    }

    public static bookkeepingLocked(msg: string): never {
        throw new FORBIDDEN_BOOKKEEPING_LOCKED({displayMessage: msg});
    }

    public static notAuthorized(tag: "NotAuthorized" | "NotAuthorizedToCallApi" | "NotAuthorizedToAccessObject", msg: string): never {
        if (tag === "NotAuthorizedToCallApi" || tag === "NotAuthorizedToAccessObject") {
            throw new FORBIDDEN({displayMessage: msg});
        }
        throw new NOT_AUTHORIZED({displayMessage: msg});
    }
}

export type ValidationErrorsType<T> = ValidationErrorMsgObject<T> & {
    errors?: {
        [P in keyof T]?: T[P] extends string | number | boolean | undefined ? ValidationErrorMsgObject<T[P]> : ValidationErrorsType<T[P]>
    }
}

export interface ValidationErrorMsgObject<T> {
    msg: string;
}
