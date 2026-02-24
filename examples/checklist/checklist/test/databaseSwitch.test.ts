import {ChecklistRuntime} from "../checklist";
import {BlockerRuntime} from "../../blocker/blocker";
import {ChecklistConfig} from "../ChecklistConfig";
import {BlockerConfig} from "../../blocker/BlockerConfig";
import {GGTest} from "@grest-ts/testkit";
import {GGPostgresHostData} from "@grest-ts/db-postgre";
import {GGPostgresSchemaCloner} from "@grest-ts/db-postgre/testkit";
import {InvalidCredentialsError, UserPublicApi} from "../../common/api-user-public/UserPublicApi";
import {sleep} from "@grest-ts/common";
import {postgresLocal as checklistDb} from "../config/local";
import {postgresLocal as blockerDb} from "../../blocker/config/local";

import {ChecklistUserContext} from "./utils/ChecklistUserContext";

describe("database switch", () => {

    const t = GGTest.startWorker({checklist: ChecklistRuntime, blocker: BlockerRuntime});
    GGTest.with(ChecklistConfig.resources.postgres).clone({from: checklistDb});
    GGTest.with(BlockerConfig.db).clone({from: blockerDb});

    const alice = new ChecklistUserContext("Alice")
        .resetAfterEach()
        .apis({
            userPublic: UserPublicApi
        })
    beforeAll(async () => {
        await alice.register({username: "alice", email: "alice@example.com", password: "secret123"})
    })

    let newDbConfig: GGPostgresHostData | undefined;

    afterAll(async () => {
        // Cleanup: drop the second database we created
        if (newDbConfig) {
            await GGPostgresSchemaCloner.cleanup(newDbConfig, checklistDb.user);
        }
    });

    test('switching database connection via config update', async () => {
        // Clone from the BASE database (checklistDb.host), not the runtime's active test DB.
        // cloneSchema() uses pg_terminate_backend() which would kill the runtime's connection.
        newDbConfig = await GGPostgresSchemaCloner.clone(
            checklistDb.host as GGPostgresHostData,
            checklistDb.user,
            "switch_" + Math.random().toString(36).substring(2, 8)
        );
        const cursor = await t.checklist.logs.cursor();
        await t.checklist.config.update(ChecklistConfig.resources.postgres.host, newDbConfig!);
        await sleep(300, "So that new connection is established. Config update only assures config is updated, but new connection establishment is separate.")

        // ---------------------
        // Retrieve logs and verify connection to new database
        const logs = await cursor.retrieve();
        const connectLogs = logs.filter(l =>
            l.message?.includes('Postgres connected!')
        );
        expect(connectLogs.length).toBeGreaterThan(0);
        expect(connectLogs.some(l => l.data?.database === newDbConfig!.database)).toBe(true);

        // ---------------------
        // Register a new user in the NEW database (proves the new DB is used)
        await alice.userPublic.register({username: "bobswitch", email: "bob@switch.com", password: "secret123"});
        await alice.userPublic.login({username: "bobswitch", password: "secret123"})
            .toMatchObject({user: {username: "bobswitch"}})

        // Alice was registered in the OLD database (in beforeAll) - she should NOT exist in new db
        // Her login should fail because her user record doesn't exist in the new database
        await alice.userPublic.login({username: "alice", password: "secret123"}).toBeError(InvalidCredentialsError);
    });
})
