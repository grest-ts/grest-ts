import {ChecklistApi} from "../../common/api-user/ChecklistApi";
import {AddressResolverService} from "../services/AddressResolverService";
import {ChecklistRuntime} from "../checklist";
import {BlockerRuntime} from "../../blocker/blocker";
import {ChecklistConfig} from "../ChecklistConfig";
import {BlockerConfig} from "../../blocker/BlockerConfig";
import {GGTest, mockOf, spyOn} from "@grest-ts/testkit";
import {UserPublicApi} from "../../common/api-user-public/UserPublicApi";
import {postgresLocal as checklistDb} from "../config/local";
import {postgresLocal as blockerDb} from "../../blocker/config/local";

import {ChecklistUserContext} from "./utils/ChecklistUserContext";

describe("checklist", () => {

    GGTest.startWorker([ChecklistRuntime, BlockerRuntime]);
    GGTest.with(ChecklistConfig.resources.postgres).clone({from: checklistDb});
    GGTest.with(BlockerConfig.db).clone({from: blockerDb});

    const alice = new ChecklistUserContext("Alice")
        .apis({
            userPublic: UserPublicApi,
            checklist: ChecklistApi
        })
        .beforeAll(async () => {
            await alice.register({username: "alice", email: "alice@example.com", password: "secret123"})
        })

    test('CRUD', async () => {
        const item = await alice.checklist
            .add({
                title: "Buy groceries",
                description: "Milk, eggs, bread"
            })
            .toMatchObject({
                userId: alice.user.id,
                title: "Buy groceries",
                done: false
            });

        await alice.checklist.list().toMatchObject([{
            id: expect.any(String),
            title: "Buy groceries",
            description: "Milk, eggs, bread",
            done: false
        }]);

        await alice.checklist
            .edit({
                ...item,
                title: "Buy groceries and snacks",
                description: "Milk, eggs, bread, chips",
            })
            .toMatchObject({
                title: "Buy groceries and snacks",
                description: "Milk, eggs, bread, chips",
                done: false
            });

        await alice.checklist.list().toMatchObject([{
            id: expect.any(String),
            title: "Buy groceries and snacks",
            description: "Milk, eggs, bread, chips",
            done: false
        }]);

        await alice.checklist
            .markDone({id: item.id})
            .toMatchObject({
                title: "Buy groceries and snacks",
                description: "Milk, eggs, bread, chips",
                done: true
            });

        await alice.checklist.list().toMatchObject([{
            id: expect.any(String),
            title: "Buy groceries and snacks",
            description: "Milk, eggs, bread, chips",
            done: true
        }]);

        await alice.checklist.delete({id: item.id});
    })

    test('checklist items can have address with geolocation', async () => {
        const timesSquare = await alice.checklist
            .add({
                title: "Visit Times Square",
                description: "Tourist destination",
                address: "123 Main St, New York, NY"
            })
            .with(mockOf(AddressResolverService).resolveAddress
                .toEqual({address: "123 Main St, New York, NY"})
                .andReturn({lat: 40.7589, lng: -73.9851})
            )
            .toMatchObject({
                userId: alice.user.id,
                title: "Visit Times Square",
                address: "123 Main St, New York, NY",
                lat: 40.7589,
                lng: -73.9851,
                done: false
            });

        await alice.checklist
            .list()
            .toHaveLength(1)
            .arrayToContain({title: "Visit Times Square"});

        await alice.checklist.delete({id: timesSquare.id});
    })

    test('mockable test', async () => {
        const item1 = await alice.checklist.add({
            title: "Buy groceries",
            description: "Milk, eggs, bread"
        });
        const item2 = await alice.checklist.add({
            title: "Visit Times Square",
            address: "123 Main St, New York, NY"
        })
            .with(mockOf(AddressResolverService).resolveAddress
                .toEqual({address: "123 Main St, New York, NY"})
                .andReturn({lat: 11, lng: -73.9851})
            );

        const list = await alice.checklist.list().toMatchObject([
            expect.objectContaining({
                title: "Buy groceries",
                done: false
            }),
            expect.objectContaining({
                title: "Visit Times Square",
                lat: 11,
                lng: -73.9851,
                done: false
            })
        ]);
        expect(list).toHaveLength(2);
        expect(list).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    title: "Buy groceries",
                    done: false
                }),
                expect.objectContaining({
                    title: "Visit Times Square",
                    lat: 11,
                    lng: -73.9851
                })
            ])
        );
        await alice.checklist.delete({id: item1.id});
        await alice.checklist.delete({id: item2.id});
    })

    test('mockable spy test', async () => {
        const item1 = await alice.checklist.add({
            title: "Buy groceries",
            description: "Milk, eggs, bread"
        });
        const item2 = await alice.checklist.add({
            title: "Visit Times Square",
            address: "123 Main St, New York, NY"
        })
            .with(spyOn(AddressResolverService).resolveAddress
                .toEqual({address: "123 Main St, New York, NY"})
                .responseToMatchObject({lat: 40.7128, lng: -74.0060})
            );

        await alice.checklist.list()
            .toMatchObject(expect.arrayContaining([
                expect.objectContaining({
                    title: "Buy groceries",
                    done: false
                }),
                expect.objectContaining({
                    title: "Visit Times Square",
                    lat: 40.7128,
                    lng: -74.0060
                })
            ]));

        await alice.checklist.delete({id: item1.id});
        await alice.checklist.delete({id: item2.id});
    })
})
