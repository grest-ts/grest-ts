import {FORBIDDEN, GGContractImplementation, NOT_FOUND} from "@grest-ts/schema"
import {AddChecklistRequest, ChecklistApiContract, ChecklistItem, EditChecklistRequest, tChecklistId} from "../../common/api-user/ChecklistApi";
import {ItemMarkedEvent} from "../../common/api-user/ChecklistNotificationApi";
import {AddressResolverService} from "./AddressResolverService";
import {tLatitude, tLongitude, tUint} from "@grest-ts/schema";
import {UserContext} from "../UserContext";

export class ChecklistService implements GGContractImplementation<typeof ChecklistApiContract["methods"]> {
    private items: Map<tChecklistId, ChecklistItem> = new Map()
    private nextItemId = 1
    private onItemMarkedCallback?: (event: ItemMarkedEvent) => void
    private addressResolver = new AddressResolverService()

    public setOnItemMarkedCallback(callback: (event: ItemMarkedEvent) => void): void {
        this.onItemMarkedCallback = callback
    }

    public async list(): Promise<ChecklistItem[]> {
        const user = UserContext.assert();
        const userItems: ChecklistItem[] = []
        for (const item of this.items.values()) {
            if (item.userId === user.id) {
                userItems.push(item)
            }
        }
        return userItems
    }

    public async add(request: AddChecklistRequest): Promise<ChecklistItem> {
        const user = UserContext.assert();
        const itemId = `item-${this.nextItemId++}` as tChecklistId
        const now = Date.now() as tUint

        // Resolve address to lat/lng if provided
        let lat: tLatitude | undefined
        let lng: tLongitude | undefined
        if (request.address) {
            const location = await this.addressResolver.resolveAddress(request.address)
            lat = location.lat
            lng = location.lng
        }

        const item: ChecklistItem = {
            id: itemId,
            userId: user.id,
            title: request.title,
            description: request.description,
            address: request.address,
            lat,
            lng,
            done: false,
            createdAt: now,
            updatedAt: now
        }

        this.items.set(itemId, item)
        return item
    }

    public async get({id}: { id: tChecklistId }): Promise<ChecklistItem> {
        const user = UserContext.assert();
        const item = this.items.get(id)
        if (!item) {
            throw new NOT_FOUND()
        }

        // Check ownership
        if (item.userId !== user.id) {
            throw new FORBIDDEN()
        }

        return item
    }

    public async edit(request: EditChecklistRequest): Promise<ChecklistItem> {
        const user = UserContext.assert();
        const item = this.items.get(request.id)
        if (!item) {
            throw new NOT_FOUND()
        }

        // Check ownership
        if (item.userId !== user.id) {
            throw new FORBIDDEN()
        }

        // Update fields
        if (request.title !== undefined) {
            item.title = request.title
        }
        if (request.description !== undefined) {
            item.description = request.description
        }
        if (request.address !== undefined) {
            item.address = request.address

            // Re-resolve address to lat/lng if changed
            if (request.address) {
                const location = await this.addressResolver.resolveAddress(request.address)
                item.lat = location.lat
                item.lng = location.lng
            } else {
                // Address was cleared
                item.lat = undefined
                item.lng = undefined
            }
        }

        item.updatedAt = Date.now() as tUint
        return item
    }

    public async delete({id}: { id: tChecklistId }): Promise<void> {
        const user = UserContext.assert();
        const item = this.items.get(id)
        if (!item) {
            throw new NOT_FOUND()
        }

        // Check ownership
        if (item.userId !== user.id) {
            throw new FORBIDDEN()
        }

        this.items.delete(id)
    }

    public async markDone({id}: { id: tChecklistId }): Promise<ChecklistItem> {
        const user = UserContext.assert();
        const item = this.items.get(id)
        if (!item) {
            throw new NOT_FOUND()
        }

        // Check ownership
        if (item.userId !== user.id) {
            throw new FORBIDDEN()
        }

        item.done = !item.done // Toggle done status
        item.updatedAt = Date.now() as tUint

        // Broadcast notification to all connected clients for this user
        if (this.onItemMarkedCallback) {
            this.onItemMarkedCallback({
                item: item,
                markedBy: user.username
            })
        }

        return item
    }
}
