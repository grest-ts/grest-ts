/**
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

import type {tAuthToken} from '@grest-ts/node'
import type {tLatitude, tLongitude} from '@grest-ts/validator'

export type tUserAuthToken = string & tAuthToken & { tUserAuthToken: never }

export interface User {
    id: tUserId
    username: string
    email: string
}

export type tUserId = string & { tUserId: never }

export interface ChecklistItem {
    id: tChecklistId
    userId: tUserId
    title: string
    description?: string
    address?: string
    lat?: tLatitude
    lng?: tLongitude
    done: boolean
    createdAt: number
    updatedAt: number
}

export type tChecklistId = string & { tChecklistId: never }
