import {ConstructorOf} from "@grest-ts/common";
import {ERROR, GGErrorData} from "@grest-ts/schema";
import {GGLog} from "@grest-ts/logger";

/** Checks the error a call ended with against `.toBeError(type)` and its `.withContext(context)`. */
export function checkError(error: ERROR<any, any>, type: ConstructorOf<ERROR<any, any>> | undefined, context: Partial<GGErrorData> | undefined): void {
    if (!type) {
        GGLog.error("GGTest", error);
        const displayMessage = error.context?.displayMessage ? ": " + error.context.displayMessage : "";
        throw new Error("Expected success 'OK', but got error '" + error.type + "'" + displayMessage, {cause: error});
    }
    if (error.constructor.name !== type.name) {
        throw new Error(`Expected error '${type.name}', but got '${error.constructor.name}'`, {cause: error});
    }
    if (context) {
        expect(error.context, `Context of error '${error.type}'`).toMatchObject(context);
    }
}
