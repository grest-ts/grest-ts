import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsNumber, IsRecord, IsString, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

const IsTypeToNumberRecord = IsRecord(IsString, IsNumber)

export const IsOverviewResultMonth = IsObject({
    month: IsNumber.orNull.orUndefined,
    invoices: IsObject({
        byType: IsTypeToNumberRecord,
        totalSum: IsNumber
    }),
    deposit: IsObject({
        inSum: IsNumber,
        outSum: IsNumber
    }),
    expenses: IsObject({
        byType: IsTypeToNumberRecord,
        totalSum: IsNumber
    }),
    payments: IsObject({
        byType: IsTypeToNumberRecord,
        totalSum: IsNumber
    }),
    payouts: IsObject({
        byType: IsTypeToNumberRecord,
        totalSum: IsNumber
    }),
    totalSum: IsNumber
})
export type OverviewResultMonth = typeof IsOverviewResultMonth.infer

export const IsOverviewResultYear = IsObject({
    year: IsNumber,
    months: IsArray(IsOverviewResultMonth),
    summary: IsOverviewResultMonth
})
export type OverviewResultYear = typeof IsOverviewResultYear.infer

export const IsOverviewResult = IsObject({
    rows: IsArray(IsOverviewResultYear)
})
export type OverviewResult = typeof IsOverviewResult.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const OverviewApiContract = new GGContractClass("OverviewApi", {
    getOverview: {
        success: IsOverviewResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const OverviewApi = new GGHttpSchema({
    contract: OverviewApiContract,
    pathPrefix: "gg/overview",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        getOverview: GGRpc.POST("getOverview")
    },
})

