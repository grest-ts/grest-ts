import {GG_CLIENT_INFO, GG_FEATURE_FLAGS, IMiddlewareTestApi, MiddlewareTestRequest, MiddlewareTestResponse} from "../api/MiddlewareTestApi";
import {GG_INTL_LOCALE} from "@grest-ts/intl";

export class MiddlewareTestService implements IMiddlewareTestApi {

    public async echo(request: MiddlewareTestRequest): Promise<MiddlewareTestResponse> {
        const locale = GG_INTL_LOCALE.get();
        const clientInfo = GG_CLIENT_INFO.assert();
        const features = GG_FEATURE_FLAGS.assert();
        return {
            message: request.message,
            language: locale?.locale,
            clientVersion: clientInfo.version,
            clientPlatform: clientInfo.platform,
            darkMode: features.darkMode,
            betaFeatures: features.betaFeatures
        };
    }

    public async getLanguage(): Promise<{language?: string}> {
        return {language: GG_INTL_LOCALE.get()?.locale}
    }
}
