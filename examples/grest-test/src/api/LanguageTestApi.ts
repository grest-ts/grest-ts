import {GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, GGContractImplementation, IsNumber, IsObject, IsString, SERVER_ERROR, VALIDATION_ERROR, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {intlLocaleHeader} from "@grest-ts/intl";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsLanguageTestRequest = IsObject({
    name: IsString,
    age: IsNumber
})
export type LanguageTestRequest = typeof IsLanguageTestRequest.infer

export const IsLanguageTestResponse = IsObject({
    receivedName: IsString,
    receivedAge: IsNumber,
    detectedLanguage: IsString.orUndefined
})
export type LanguageTestResponse = typeof IsLanguageTestResponse.infer

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const LanguageTestApiContract = new GGContractClass("LanguageTestApi", {
    echo: {
        input: IsLanguageTestRequest,
        success: IsLanguageTestResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    }
})

export type ILanguageTestApi = GGContractImplementation<typeof LanguageTestApiContract["methods"]>
export const LanguageTestApi = httpSchema(LanguageTestApiContract)
    .pathPrefix("api/language-test")
    .use(intlLocaleHeader())
    .routes({
        echo: GGRpc.POST("echo"),
    })
