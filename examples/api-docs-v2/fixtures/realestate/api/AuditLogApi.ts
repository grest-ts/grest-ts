import {GGRpc, GGHttpSchema} from "@grest-ts/http";
import {IsAny, IsArray, IsObject, IsString, IsNumber, IsEnum, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsDate, IsUserId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";

// ---------------------------------------------------------
// Type Schemas - IDs
// ---------------------------------------------------------

export const IsAuditLogId = IsNumber.brand("AuditLogId");
export type tAuditLogId = typeof IsAuditLogId.infer

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum AuditLogEntity {
    company = "company",
    contract = "contract",
    invoice = "invoice",
    payment = "payment",
    bankStatement = "bankStatement",
    expense = "expense",
    insurance = "insurance",
    building = "building",
    apartment = "apartment",
    client = "client",
    owner = "owner",
    user = "user",
    companyUser = "companyUser",
    expenseFile = "expenseFile",
    emailTemplate = "emailTemplate",
    invoiceTemplate = "invoiceTemplate",
    file = "file",
    ownerExpense = "ownerExpense",
    invoiceFutureRow = "invoiceFutureRow",
    task = "task",
    taskDelegation = "taskDelegation"
}

const IsAuditLogEntity = IsEnum(AuditLogEntity)

export enum AuditLogOperation {
    INSERT = "insert",
    UPDATE = "update",
    DELETE = "delete"
}

// ---------------------------------------------------------
// Type Schemas - Requests & Responses
// ---------------------------------------------------------

export const IsAuditLogQuery = IsObject({
    id: IsAuditLogId.orNull.orUndefined,
    start: IsDate.orNull.orUndefined,
    end: IsDate.orNull.orUndefined,
    userId: IsUserId.orNull.orUndefined,
    entity: IsAuditLogEntity.orNull.orUndefined,
    entityId: IsNumber.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("created"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined
})
export type AuditLogQuery = typeof IsAuditLogQuery.infer

export const IsAuditLogResponseRow = IsObject({
    id: IsAuditLogId,
    createdDate: IsDate,
    created: IsString,
    userId: IsUserId.orNull,
    username: IsString.orNull,
    entity: IsAuditLogEntity,
    entityId: IsNumber,
    activity: IsString.orNull,
    data: IsAny
})
export type AuditLogResponseRow = typeof IsAuditLogResponseRow.infer

export const IsAuditLogResponse = IsObject({
    rows: IsArray(IsAuditLogResponseRow)
})
export type AuditLogResponse = typeof IsAuditLogResponse.infer

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const AuditLogApiContract = new GGContractClass("AuditLogApi", {
    list: {
        input: IsAuditLogQuery,
        success: IsAuditLogResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const AuditLogApi = new GGHttpSchema({
    contract: AuditLogApiContract,
    pathPrefix: "gg/auditLog",
    use: [GG_USER_AUTH, GG_COMPANY_AUTH_TOKEN],
    routes: {
        list: GGRpc.POST("list")
    },
})

// ---------------------------------------------------------
// Types used by AuditLog service
// ---------------------------------------------------------


export type AnyAuditLogDataObj = AuditLogDataObjInsert | AuditLogDataObjUpdate | AuditLogDataObjDelete

export interface AuditLogDataObj {
    operation: AuditLogOperation
}

export interface AuditLogDataObjInsert extends AuditLogDataObj {
    operation: AuditLogOperation.INSERT
    next: { [key: string]: string | number }
}

export interface AuditLogDataObjUpdate extends AuditLogDataObj {
    operation: AuditLogOperation.UPDATE
    prev: { [key: string]: string | number }
    next: { [key: string]: string | number }
}

export interface AuditLogDataObjDelete extends AuditLogDataObj {
    operation: AuditLogOperation.DELETE
    prev: { [key: string]: string | number }
}

