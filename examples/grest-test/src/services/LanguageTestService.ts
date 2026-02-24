import {ILanguageTestApi, LanguageTestRequest, LanguageTestResponse} from "../api/LanguageTestApi";
import {GG_INTL_LOCALE} from "@grest-ts/intl";

export class LanguageTestService implements ILanguageTestApi {

    public async echo(request: LanguageTestRequest): Promise<LanguageTestResponse> {
        return {
            receivedName: request.name,
            receivedAge: request.age,
            detectedLanguage: GG_INTL_LOCALE.get()?.locale
        };
    }
}
