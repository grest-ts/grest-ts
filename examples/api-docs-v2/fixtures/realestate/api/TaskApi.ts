import {GGRpc, httpSchema} from "@grest-ts/http";
import {IsArray, IsObject, IsString, IsNumber, IsEnum, IsLiteral, IsTuple, GGContractClass, FORBIDDEN, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR, VALIDATION_ERROR } from "@grest-ts/schema";
import {IsCreatedAndChangedBy} from "./UserApi";
import {GG_COMPANY_AUTH_TOKEN} from "../middleware/CompanyAuthHeader";
import {IsApartmentId, IsBuildingId, IsClientId, IsContractId, IsDate, IsDateTime, IsTaskCommentId, IsTaskDelegationId, IsTaskId, IsUserId} from "../Brands";
import {GG_USER_AUTH} from "../middleware/UserAuthHeader";
import {IsListUploadedFileResponseRow} from "./UploadedFileApi";

// ---------------------------------------------------------
// Enums
// ---------------------------------------------------------

export enum TaskState {
    open = "open",
    done = "done",
    cancelled = "cancelled"
}

export const IsTaskState = IsEnum(TaskState)

export type TaskPriority = 1 | 2 | 3 | 4

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {1: "Low", 2: "Normal", 3: "High", 4: "Urgent"}

export const IsTaskPriority = IsLiteral(1, 2, 3, 4)

export enum TaskDelegationState {
    pending = "pending",
    done = "done",
    problem = "problem",
    cancelled = "cancelled"
}

export const IsTaskDelegationState = IsEnum(TaskDelegationState)

// ---------------------------------------------------------
// Type Schemas - Requests
// ---------------------------------------------------------

export const IsTasksQuery = IsObject({
    id: IsTaskId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    state: IsTaskState.orNull.orUndefined,
    priority: IsTaskPriority.orNull.orUndefined,
    ownerUserId: IsUserId.orNull.orUndefined,
    buildingId: IsBuildingId.orNull.orUndefined,
    apartmentId: IsApartmentId.orNull.orUndefined,
    contractId: IsContractId.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("title", "startDate", "priority", "state", "created"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined,
    closedAfter: IsDate.orNull.orUndefined,
})
export type TasksQuery = typeof IsTasksQuery.infer

export const IsTaskGetRequest = IsObject({
    id: IsTaskId
})
export type TaskGetRequest = typeof IsTaskGetRequest.infer

export const IsTaskDeleteRequest = IsObject({
    id: IsTaskId
})
export type TaskDeleteRequest = typeof IsTaskDeleteRequest.infer

// ---------------------------------------------------------
// Type Schemas - Responses
// ---------------------------------------------------------

export const IsTasksResultRow = IsObject({
    id: IsTaskId,
    title: IsString,
    state: IsTaskState,
    priority: IsTaskPriority,
    startDate: IsDate.orNull,
    buildingId: IsBuildingId.orNull,
    apartmentId: IsApartmentId.orNull,
    contractId: IsContractId.orNull,
    ownerUserId: IsUserId.orNull,
    ownerUserName: IsString.orNull,
    activeDelegationsCount: IsNumber,
    activeDelegationNames: IsString.orNull,
    created: IsString,
    changed: IsString,
    closedDate: IsDateTime.orNull,
    version: IsNumber,
})
export type TasksResultRow = typeof IsTasksResultRow.infer

export const IsTasksResult = IsObject({
    query: IsTasksQuery,
    rows: IsArray(IsTasksResultRow)
})
export type TasksResult = typeof IsTasksResult.infer

// Query for related tasks (used in entity tabs — cascading scope)
export const IsTasksRelatedQuery = IsObject({
    buildingId: IsBuildingId.orNull.orUndefined,
    apartmentId: IsApartmentId.orNull.orUndefined,
    contractId: IsContractId.orNull.orUndefined,
    search: IsString.orNull.orUndefined,
    state: IsTaskState.orNull.orUndefined,
    priority: IsTaskPriority.orNull.orUndefined,
    ownerUserId: IsUserId.orNull.orUndefined,
    orderBy: IsObject({
        field: IsLiteral("title", "startDate", "priority", "state", "created"),
        dir: IsLiteral("asc", "desc").orUndefined
    }).orNull.orUndefined,
    limit: IsTuple(IsNumber, IsNumber).orNull.orUndefined,
    closedAfter: IsDate.orNull.orUndefined,
})
export type TasksRelatedQuery = typeof IsTasksRelatedQuery.infer

export const IsTasksRelatedResultRow = IsObject({
    id: IsTaskId,
    title: IsString,
    state: IsTaskState,
    priority: IsTaskPriority,
    startDate: IsDate.orNull,
    ownerUserId: IsUserId.orNull,
    ownerUserName: IsString.orNull,
    buildingAddress: IsString.orNull,
    apartmentAddress: IsString.orNull,
    contractClientName: IsString.orNull,
    created: IsString,
    closedDate: IsDateTime.orNull,
})
export type TasksRelatedResultRow = typeof IsTasksRelatedResultRow.infer

export const IsTasksRelatedResult = IsObject({
    query: IsTasksRelatedQuery,
    rows: IsArray(IsTasksRelatedResultRow)
})
export type TasksRelatedResult = typeof IsTasksRelatedResult.infer

export const IsSyncTaskData = IsObject({
    id: IsTaskId.orUndefined,
    title: IsString,
    description: IsString.orNull,
    state: IsTaskState,
    priority: IsTaskPriority,
    startDate: IsDate.orNull,
    buildingId: IsBuildingId.orNull,
    apartmentId: IsApartmentId.orNull,
    contractId: IsContractId.orNull,
    ownerUserId: IsUserId.orNull,
    recurringIntervalDays: IsNumber.orNull,
    // Display-only (returned by get, ignored by sync)
    ownerUserName: IsString.orNull.orUndefined,
    resolvedContract: IsObject({
        id: IsContractId,
        tenantName: IsString.orNull,
        tenantPhone: IsString.orNull,
        tenantEmail: IsString.orNull,
    }).orNull.orUndefined,
    closedDate: IsDateTime.orNull.orUndefined,
    version: IsNumber.orUndefined,
}).merge(IsCreatedAndChangedBy)
export type SyncTaskData = typeof IsSyncTaskData.infer

export const IsTaskSyncResponse = IsObject({
    id: IsTaskId,
    version: IsNumber,
})
export type TaskSyncResponse = typeof IsTaskSyncResponse.infer

// ---------------------------------------------------------
// Type Schemas - Delegation
// ---------------------------------------------------------

export const IsTaskDelegationListRequest = IsObject({
    taskId: IsTaskId
})
export type TaskDelegationListRequest = typeof IsTaskDelegationListRequest.infer

export const IsTaskDelegationResultRow = IsObject({
    id: IsTaskDelegationId,
    taskId: IsTaskId,
    clientId: IsClientId,
    clientName: IsString,
    clientEmail: IsString.orNull,
    description: IsString.orNull,
    state: IsTaskDelegationState,
    responseNote: IsString.orNull,
    respondedAt: IsString.orNull,
    created: IsString,
    token: IsString.orNull.orUndefined,
    tenantName: IsString.orNull.orUndefined,
    tenantPhone: IsString.orNull.orUndefined,
})
export type TaskDelegationResultRow = typeof IsTaskDelegationResultRow.infer

export const IsTaskDelegationListResponse = IsObject({
    rows: IsArray(IsTaskDelegationResultRow)
})
export type TaskDelegationListResponse = typeof IsTaskDelegationListResponse.infer

export const IsSendDelegationRequest = IsObject({
    taskId: IsTaskId,
    clientId: IsClientId,
    description: IsString.orNull,
    addTenantPhone: IsLiteral(0, 1).orUndefined,
})
export type SendDelegationRequest = typeof IsSendDelegationRequest.infer

export const IsSendDelegationResponse = IsObject({
    id: IsTaskDelegationId
})
export type SendDelegationResponse = typeof IsSendDelegationResponse.infer

export const IsResendDelegationRequest = IsObject({
    id: IsTaskDelegationId
})
export type ResendDelegationRequest = typeof IsResendDelegationRequest.infer

export const IsDeleteDelegationRequest = IsObject({
    id: IsTaskDelegationId
})
export type DeleteDelegationRequest = typeof IsDeleteDelegationRequest.infer

export const IsCancelDelegationRequest = IsObject({
    id: IsTaskDelegationId
})
export type CancelDelegationRequest = typeof IsCancelDelegationRequest.infer

// ---------------------------------------------------------
// Type Schemas - Comments
// ---------------------------------------------------------

export const IsTaskCommentMetadata = IsObject({
    delay: IsObject({
        date: IsString,
    }).orUndefined,
    delegation: IsObject({
        clientName: IsString,
        clientEmail: IsString.orNull.orUndefined,
        action: IsLiteral("sent", "resent", "cancelled"),
        emailSent: IsLiteral(0, 1).orUndefined,
    }).orUndefined,
    delegationResponse: IsObject({
        action: IsLiteral("done", "problem"),
    }).orUndefined,
    taskCreated: IsLiteral(1).orUndefined,
    fieldChanges: IsObject({
        startDate: IsObject({ from: IsString.orNull, to: IsString.orNull }).orUndefined,
        ownerUserId: IsObject({ from: IsUserId.orNull, to: IsUserId.orNull, fromName: IsString.orNull, toName: IsString.orNull }).orUndefined,
        buildingId: IsObject({ from: IsBuildingId.orNull, to: IsBuildingId.orNull, fromName: IsString.orNull, toName: IsString.orNull }).orUndefined,
        apartmentId: IsObject({ from: IsApartmentId.orNull, to: IsApartmentId.orNull, fromName: IsString.orNull, toName: IsString.orNull }).orUndefined,
        priority: IsObject({ from: IsTaskPriority.orNull, to: IsTaskPriority.orNull }).orUndefined,
        state: IsObject({ from: IsTaskState.orNull, to: IsTaskState.orNull }).orUndefined,
        title: IsLiteral(1).orUndefined,
        description: IsLiteral(1).orUndefined,
        fileAdded: IsLiteral(1).orUndefined,
        fileDeleted: IsLiteral(1).orUndefined,
    }).orUndefined,
})
export type TaskCommentMetadata = typeof IsTaskCommentMetadata.infer

export const IsTaskCommentListRequest = IsObject({
    taskId: IsTaskId
})
export type TaskCommentListRequest = typeof IsTaskCommentListRequest.infer

export const IsTaskCommentResultRow = IsObject({
    id: IsTaskCommentId,
    taskId: IsTaskId,
    taskDelegationId: IsTaskDelegationId.orNull,
    userId: IsUserId.orNull,
    userName: IsString.orNull,
    clientId: IsClientId.orNull,
    clientName: IsString.orNull,
    text: IsString,
    metadata: IsTaskCommentMetadata.orNull,
    isAutoGenerated: IsLiteral(0, 1),
    created: IsString,
})
export type TaskCommentResultRow = typeof IsTaskCommentResultRow.infer

export const IsTaskCommentListResponse = IsObject({
    rows: IsArray(IsTaskCommentResultRow)
})
export type TaskCommentListResponse = typeof IsTaskCommentListResponse.infer

export const IsAddTaskCommentRequest = IsObject({
    taskId: IsTaskId,
    text: IsString,
    metadata: IsTaskCommentMetadata.orNull.orUndefined,
})
export type AddTaskCommentRequest = typeof IsAddTaskCommentRequest.infer

export const IsEditTaskCommentRequest = IsObject({
    id: IsTaskCommentId,
    text: IsString,
})
export type EditTaskCommentRequest = typeof IsEditTaskCommentRequest.infer

export const IsEditDelegationDescriptionRequest = IsObject({
    id: IsTaskDelegationId,
    description: IsString.orNull,
})
export type EditDelegationDescriptionRequest = typeof IsEditDelegationDescriptionRequest.infer

// ---------------------------------------------------------
// Type Schemas - Calendar
// ---------------------------------------------------------

export const IsTaskCalendarRequest = IsObject({
    startDate: IsDate,
    endDate: IsDate,
    ownerUserId: IsUserId.orNull.orUndefined,
})
export type TaskCalendarRequest = typeof IsTaskCalendarRequest.infer

export const IsTaskCalendarEntry = IsObject({
    id: IsTaskId,
    title: IsString,
    state: IsTaskState,
    priority: IsTaskPriority,
    startDate: IsDate,
    buildingId: IsBuildingId.orNull,
    apartmentId: IsApartmentId.orNull,
    ownerUserId: IsUserId.orNull,
    ownerUserName: IsString.orNull,
    activeDelegationsCount: IsNumber,
    version: IsNumber,
})
export type TaskCalendarEntry = typeof IsTaskCalendarEntry.infer

export const IsTaskCalendarResponse = IsObject({
    rows: IsArray(IsTaskCalendarEntry)
})
export type TaskCalendarResponse = typeof IsTaskCalendarResponse.infer

// ---------------------------------------------------------
// Type Schemas - Detail (combined task + timeline + files)
// ---------------------------------------------------------

export const IsTaskDetailTimelineItem = IsObject({
    type: IsLiteral("comment", "delegationSent"),
    created: IsString,
    files: IsArray(IsListUploadedFileResponseRow),
    comment: IsTaskCommentResultRow.orNull,
    delegation: IsTaskDelegationResultRow.orNull,
})
export type TaskDetailTimelineItem = typeof IsTaskDetailTimelineItem.infer

export const IsTaskDetailResponse = IsObject({
    task: IsSyncTaskData,
    taskFiles: IsArray(IsListUploadedFileResponseRow),
    timeline: IsArray(IsTaskDetailTimelineItem),
})
export type TaskDetailResponse = typeof IsTaskDetailResponse.infer

// ---------------------------------------------------------
// Field change config
// ---------------------------------------------------------

export const FIELD_CHANGE_ENTRIES = [
    {field: "startDate",   type: "fromTo",      set: "Date → {to}",              clear: "Date removed"},
    {field: "ownerUserId", type: "namedFromTo",  set: "Assigned to {toName}",     clear: "Unassigned"},
    {field: "buildingId",  type: "namedFromTo",  set: "Building {toName}",        clear: "Building removed"},
    {field: "apartmentId", type: "namedFromTo",  set: "Apartment {toName}",       clear: "Apartment removed"},
    {field: "priority",    type: "fromTo",       set: "Priority → {to}",          clear: "Priority → Normal"},
    {field: "state",       type: "fromTo",       set: "State → {to}",             clear: "State → Open"},
    {field: "title",       type: "literal",      set: "Changed title",            clear: ""},
    {field: "description", type: "literal",      set: "Changed description",      clear: ""},
    {field: "fileAdded",   type: "literal",      set: "Added file",               clear: ""},
    {field: "fileDeleted", type: "literal",      set: "Deleted file",             clear: ""},
] as const;

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fieldChangeText(entry: typeof FIELD_CHANGE_ENTRIES[number], val: any): string {
    if (entry.type === "literal") return entry.set;
    if (!val.to) return entry.clear;
    const template = entry.set;
    if (entry.type === "namedFromTo") {
        return template.replace("{toName}", val.toName || "");
    }
    // fromTo — for priority use label map, for state capitalize
    const toStr = entry.field === "priority" ? TASK_PRIORITY_LABEL[val.to as TaskPriority] : entry.field === "state" ? capitalize(String(val.to)) : String(val.to);
    return template.replace("{to}", toStr);
}

// ---------------------------------------------------------
// Contract
// ---------------------------------------------------------

export const TaskApiContract = new GGContractClass("TaskApi", {
    list: {
        input: IsTasksQuery,
        success: IsTasksResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    listRelated: {
        input: IsTasksRelatedQuery,
        success: IsTasksRelatedResult,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    get: {
        input: IsTaskGetRequest,
        success: IsSyncTaskData,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    getDetail: {
        input: IsTaskGetRequest,
        success: IsTaskDetailResponse,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sync: {
        input: IsSyncTaskData,
        success: IsTaskSyncResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    delete: {
        input: IsTaskDeleteRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    listDelegations: {
        input: IsTaskDelegationListRequest,
        success: IsTaskDelegationListResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    sendDelegation: {
        input: IsSendDelegationRequest,
        success: IsSendDelegationResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    resendDelegation: {
        input: IsResendDelegationRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    deleteDelegation: {
        input: IsDeleteDelegationRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    cancelDelegation: {
        input: IsCancelDelegationRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    listComments: {
        input: IsTaskCommentListRequest,
        success: IsTaskCommentListResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    addComment: {
        input: IsAddTaskCommentRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    editComment: {
        input: IsEditTaskCommentRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    editDelegationDescription: {
        input: IsEditDelegationDescriptionRequest,
        success: undefined as undefined,
        errors: [NOT_AUTHORIZED, NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    },
    calendar: {
        input: IsTaskCalendarRequest,
        success: IsTaskCalendarResponse,
        errors: [NOT_AUTHORIZED, FORBIDDEN, VALIDATION_ERROR, SERVER_ERROR],
    }
})

// ---------------------------------------------------------
// API Definition
// ---------------------------------------------------------

export const TaskApi = httpSchema(TaskApiContract)
    .pathPrefix("gg/task")
    .use(GG_USER_AUTH)
    .use(GG_COMPANY_AUTH_TOKEN)
    .routes({
        list: GGRpc.POST("list"),
        listRelated: GGRpc.POST("listRelated"),
        get: GGRpc.POST("get"),
        getDetail: GGRpc.POST("getDetail"),
        sync: GGRpc.POST("sync"),
        delete: GGRpc.POST("delete"),
        listDelegations: GGRpc.POST("listDelegations"),
        sendDelegation: GGRpc.POST("sendDelegation"),
        resendDelegation: GGRpc.POST("resendDelegation"),
        deleteDelegation: GGRpc.POST("deleteDelegation"),
        cancelDelegation: GGRpc.POST("cancelDelegation"),
        listComments: GGRpc.POST("listComments"),
        addComment: GGRpc.POST("addComment"),
        editComment: GGRpc.POST("editComment"),
        editDelegationDescription: GGRpc.POST("editDelegationDescription"),
        calendar: GGRpc.POST("calendar")
    })
