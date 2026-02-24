import {ChecklistRuntime} from "../checklist";
import {ChecklistConfig} from "../ChecklistConfig";
import {GGTest} from "@grest-ts/testkit";
import {ChecklistNotificationApi} from "../../common/api-user/ChecklistNotificationApi";
import {UserPublicApi} from "../../common/api-user-public/UserPublicApi";
import {ChecklistApi} from "../../common/api-user/ChecklistApi";
import {postgresLocal as checklistDb} from "../config/local";

import {ChecklistUserContext} from "./utils/ChecklistUserContext";

describe("checklist notifications", () => {

    GGTest.startInline(ChecklistRuntime);
    GGTest.with(ChecklistConfig.resources.postgres).clone({from: checklistDb});

    const alice = new ChecklistUserContext("Alice")
        .apis({
            userPublic: UserPublicApi,
            checklist: ChecklistApi,
            checklistNotification: ChecklistNotificationApi
        })
    beforeAll(async () => {
        await alice.register({username: "alice", email: "alice@example.com", password: "secret123"})
        await alice.checklistNotification.connect();
    })

    test('websocket notifications work when marking items done', async () => {
        const groceries = await alice.checklist.add({
            title: "Buy groceries",
            description: "Milk, eggs, bread"
        });

        await alice.checklist
            .markDone({id: groceries.id})
            .with(alice.checklistNotification.mock.itemMarked.toMatchObject({markedBy: "alice"}))
            .toMatchObject({
                done: true
            })

        // Test updateItem without optional reason argument
        await alice.checklistNotification
            .updateItem({
                item: {
                    ...groceries,
                    title: "Buy groceries and snacks",
                    description: "Milk, eggs, bread, chips",
                    done: true
                }
            })
            .toEqual({
                success: true,
                message: "Item updated successfully via WebSocket"
            });

        // Test updateItem WITH optional reason argument (multi-arg WebSocket method test)
        await alice.checklistNotification
            .updateItem({
                item: {
                    ...groceries,
                    title: "Buy even more groceries",
                    description: "Milk, eggs, bread, chips, cookies",
                    done: true
                },
                reason: "testing multi-arg websocket"
            })
            .toEqual({
                success: true,
                message: "Item updated via WebSocket: testing multi-arg websocket",
                reason: "testing multi-arg websocket"
            });

        await alice.checklistNotification.askMeAmIHere()
            .waitFor(alice.checklistNotification.mock.areYouThere.andReturn(true));

        await alice.checklist.delete({id: groceries.id})
    });


    test('websocket notifications with Jest matchers', async () => {
        const groceries = await alice.checklist.add({
            title: "Buy groceries",
            description: "Milk, eggs, bread"
        });

        const updated = await alice.checklist
            .markDone({id: groceries.id})
            .with(alice.checklistNotification.mock.itemMarked.toMatchObject({markedBy: "alice"}));

        // Complex Jest assertions
        expect(updated).toMatchObject({
            id: groceries.id,
            userId: alice.user.id,
            title: "Buy groceries",
            done: true,
            createdAt: expect.any(Number),
            updatedAt: expect.any(Number)
        });

        expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);

        await alice.checklist.delete({id: groceries.id})
    });

    test('websocket notifications with Jest matchers with call through', async () => {
        const groceries = await alice.checklist.add({
            title: "Buy groceries",
            description: "Milk, eggs, bread"
        });

        const updated = await alice.checklist.markDone({id: groceries.id});
        // @TODO Should we fail this test?

        // Complex Jest assertions
        expect(updated).toMatchObject({
            id: groceries.id,
            userId: alice.user.id,
            title: "Buy groceries",
            done: true,
            createdAt: expect.any(Number),
            updatedAt: expect.any(Number)
        });

        expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);

        await alice.checklist.delete({id: groceries.id})
    });

});
