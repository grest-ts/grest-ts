import {IsObject, IsString, IsNumber} from "@grest-ts/schema"
import {
    IsAgent, IsTaskSummary,
    IsOrgId, IsTaskId, IsAgentId, IsBaseImageId, IsProjectImageId,
    IsServiceName,
} from "../hub/schemas"
import {IsTask, IsTaskService} from "../hub/TaskApi"
import {IsBaseImage} from "../hub/BaseImageApi"
import {IsProjectImage} from "../hub/ProjectImageApi"

/**
 * Each event carries:
 *   - topic   : routing key, MUST be built via Topics.x(...). Used for
 *               client-side dispatch lookup; server publishes under it.
 *               Redundant with the explicit IDs below — but redundant by
 *               design: the branded `Topics.task(orgId, taskId)` signature
 *               makes it a compile error to swap args or use the wrong-
 *               typed ID, and writing the event without going through
 *               Topics.x() means writing a string literal which the brand
 *               check on adjacent ID fields will catch on the next field.
 *   - explicit branded IDs : single source of truth for the event's scope.
 *               Type-safe: passing an agentId where taskId is expected,
 *               or swapping orgId and taskId, fails at compile.
 *   - version : monotonic per-entity, drives client ordering.
 *   - entity  : full new state of the entity (not a diff).
 */

export const IsTaskEvent = IsObject({
    topic:   IsString,
    orgId:   IsOrgId,
    taskId:  IsTaskId,
    version: IsNumber,
    entity:  IsObject({task: IsTask}),
})

export const IsAgentEvent = IsObject({
    topic:   IsString,
    orgId:   IsOrgId,
    taskId:  IsTaskId,    // agents belong to a task — useful for cross-event correlation
    agentId: IsAgentId,
    version: IsNumber,
    entity:  IsObject({agent: IsAgent}),
})

export const IsServiceEvent = IsObject({
    topic:       IsString,
    orgId:       IsOrgId,
    taskId:      IsTaskId,
    serviceName: IsServiceName,
    version:     IsNumber,
    entity:      IsObject({service: IsTaskService}),
})

export const IsBaseImageEvent = IsObject({
    topic:       IsString,
    baseImageId: IsBaseImageId,    // global resource — no orgId
    version:     IsNumber,
    entity:      IsObject({image: IsBaseImage}),
})

export const IsProjectImageEvent = IsObject({
    topic:          IsString,
    orgId:          IsOrgId,
    projectImageId: IsProjectImageId,
    version:        IsNumber,
    entity:         IsObject({image: IsProjectImage}),
})

export const IsTaskOverviewEvent = IsObject({
    topic:   IsString,
    orgId:   IsOrgId,
    version: IsNumber,
    entity:  IsObject({summary: IsTaskSummary}),
})

export type TaskEvent         = typeof IsTaskEvent.infer
export type AgentEvent        = typeof IsAgentEvent.infer
export type ServiceEvent      = typeof IsServiceEvent.infer
export type BaseImageEvent    = typeof IsBaseImageEvent.infer
export type ProjectImageEvent = typeof IsProjectImageEvent.infer
export type TaskOverviewEvent = typeof IsTaskOverviewEvent.infer
