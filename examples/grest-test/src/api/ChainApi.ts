/**
 * HTTP API for the chain services demo.
 */

import {GGRpc, httpSchema} from "@grest-ts/http";
import {GGContractClass, IsObject, IsString, IsNumber, IsArray, IsBoolean, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_INTL_LOCALE} from "@grest-ts/intl";

// ---------------------------------------------------------
// Type Schemas
// ---------------------------------------------------------

export const IsWeatherData = IsObject({
    temperature: IsNumber,
    condition: IsString,
    humidity: IsNumber
});

export const IsTimezoneData = IsObject({
    timezone: IsString,
    offset: IsNumber
});

export const IsCityInfo = IsObject({
    city: IsString,
    weather: IsWeatherData,
    timezone: IsTimezoneData
});

export const IsTravelPlan = IsObject({
    destination: IsCityInfo,
    recommendation: IsString,
    packingList: IsArray(IsString)
});

export const IsTravelComparison = IsObject({
    cities: IsArray(IsCityInfo),
    recommended: IsString,
    reason: IsString
});

export const IsWeatherCheck = IsObject({
    city: IsString,
    suitable: IsBoolean,
    reason: IsString,
    locale: IsString.orUndefined
});

// ---------------------------------------------------------
// Contract & API Interface
// ---------------------------------------------------------

export const ChainApiContract = new GGContractClass("ChainApi", {
    planTravel: {
        input: IsObject({destination: IsString}),
        success: IsTravelPlan,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    compareDestinations: {
        input: IsObject({destinations: IsArray(IsString)}),
        success: IsTravelComparison,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    quickWeatherCheck: {
        input: IsObject({city: IsString}),
        success: IsWeatherCheck,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    }
});

export const ChainApi = httpSchema(ChainApiContract)
    .pathPrefix("api/chain")
    .useHeader(GG_INTL_LOCALE)
    .routes({
        planTravel: GGRpc.POST("plan-travel"),
        compareDestinations: GGRpc.POST("compare-destinations"),
        quickWeatherCheck: GGRpc.POST("quick-weather-check")
    });
