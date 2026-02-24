import {EXISTS, FORBIDDEN, NOT_AUTHORIZED, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {BadUsernameError, InvalidCredentialsError, UserPublicApi} from "../../common/api-user-public/UserPublicApi";
import {BlockerApi} from "../../common/api-internal/BlockerApi";
import {BlockerUserApi} from "../../common/api-user/BlockerUserApi";
import {ChecklistRuntime} from "../checklist";
import {BlockerRuntime} from "../../blocker/blocker";
import {ChecklistConfig} from "../ChecklistConfig";
import {BlockerConfig} from "../../blocker/BlockerConfig";
import {GGTest} from "@grest-ts/testkit";
import {UserAuthApi} from "../../common/api-user/UserAuthApi";
import {ChecklistApi} from "../../common/api-user/ChecklistApi";
import "@grest-ts/http/testkit";
import {postgresLocal as checklistDb} from "../config/local";
import {postgresLocal as blockerDb} from "../../blocker/config/local";
import {ChecklistUserContext} from "./utils/ChecklistUserContext";

describe("User register & login tests", async () => {

    GGTest.startWorker([ChecklistRuntime, BlockerRuntime]);
    GGTest.with(ChecklistConfig.resources.postgres).clone({from: checklistDb});
    GGTest.with(BlockerConfig.db).clone({from: blockerDb});

    const aliceLoginData = Object.freeze({
        username: "alice",
        password: "secret123"
    })
    const aliceRegisterData = Object.freeze({
        username: "alice",
        email: "alice@example.com",
        password: "secret123"
    })
    const aliceUserData = Object.freeze({
        id: "user-1",
        username: "alice",
        email: "alice@example.com"
    })

    const alice = new ChecklistUserContext("Alice")
        .resetAfterEach()
        .apis({
            userPublic: UserPublicApi,
            userAuth: UserAuthApi,
            checklist: ChecklistApi,
            blockerUser: BlockerUserApi
        })

    test('register validation error', async () => {
        await alice.userPublic
            .register({
                username: "ab",      // ctrl+click should work now!
                password: "",
                email: "invalid",  // cast only email, not the whole object
            })
            .toBeError(VALIDATION_ERROR)
            .toMatchObject({
                username: {__issue: {message: "Value must be between 3 and 10 characters"}},
                email: {__issue: {message: "Invalid email format"}},
                password: {__issue: {message: "Value must not be empty"}}
            })
    });

    test('register alice', async () => {
        const result = await alice.userPublic
            .register(aliceRegisterData)
            .toMatchObject({
                user: {
                    username: "alice",
                    email: "alice@example.com"
                },
                token: expect.any(String)
            });

        expect(result).toBeDefined();
        expect(result.user).toMatchObject(aliceUserData)
        expect(result.user.username).toBe("alice")
        expect(result).toMatchObject({
            user: aliceUserData,
            token: expect.stringMatching(/^token-/)
        });

        // Auth must fail, as not logged in to state
        const res1 = await alice.checklist.list().toBeError(NOT_AUTHORIZED);
        expect(res1).toEqual(undefined)

        alice.setLoggedIn(result.token);

        // Check that can call api method. Auth must pass.
        const res2 = await alice.checklist.list().toMatchObject([]);
        expect(res2.length).toBe(0);
    });

    test('register alice, already exists', async () => {
        await alice.userPublic
            .register(aliceRegisterData)
            .toBeError(EXISTS)
    });

    test('register with bad username', async () => {
        await alice.userPublic
            .register({username: "baduser", password: "wrong_password", email: "aa@aa.ee"})
            .toBeError(BadUsernameError)
    });

    // --------------------------------------------
    // login tests
    // --------------------------------------------

    test('login alice with wrong credentials', async () => {
        await alice.userPublic
            .login({username: aliceLoginData.username, password: "wrong_password"})
            .toBeError(InvalidCredentialsError)
    });

    test('login alice with call through', async () => {
        const result = await alice.userPublic
            .login(aliceLoginData);
        expect(result.user).toMatchObject(aliceUserData);
        expect(result.token).toMatch(/^token-/);
    });

    test('login alice with mock', async () => {
        const result = await alice.userPublic
            .login(aliceLoginData)
            .with(BlockerApi.mock.checkBlock.andReturn({blocked: false}));
        expect(result.user).toMatchObject(aliceUserData);
        expect(result.token).toMatch(/^token-/);
    });

    test('login alice with mock, but mock says alice is blocked.', async () => {
        await alice.userPublic
            .login(aliceLoginData)
            .with(
                BlockerApi.mock.checkBlock
                    .toMatchObject({username: aliceLoginData.username})
                    .andReturn({blocked: true, reason: "Because I want to"}),
            )
            .toBeError(FORBIDDEN);
    });

    test('login alice with spy', async () => {
        const result = await alice.userPublic
            .login(aliceLoginData)
            .with(BlockerApi.spy.checkBlock
                .toMatchObject({username: aliceUserData.username})
                .response.toMatchObject({blocked: false})
            );
        expect(result.user).toMatchObject(aliceUserData);
        expect(result.token).toMatch(/^token-/);
    });

    test('login alice with spy (not checking spy output)', async () => {
        const result = await alice.userPublic
            .login(aliceLoginData)
            .with(BlockerApi.spy.checkBlock
                .toMatchObject({username: aliceUserData.username})
            );
        expect(result.user).toMatchObject(aliceUserData);
        expect(result.token).toMatch(/^token-/);
    });

    test('login alice with spy (not checking spy input)', async () => {
        const result = await alice.userPublic
            .login(aliceLoginData)
            .with(BlockerApi.spy.checkBlock
                .response.toMatchObject({blocked: false})
            );
        expect(result.user).toMatchObject(aliceUserData);
        expect(result.token).toMatch(/^token-/);
    });

    test('user can change password', async () => {

        await alice.login(aliceLoginData);

        await alice.userAuth
            .changePassword({
                oldPassword: "wrong_old_password",
                newPassword: "newSecret456"
            })
            .toBeError(NOT_AUTHORIZED);

        await alice.userAuth
            .changePassword({
                oldPassword: aliceLoginData.password,
                newPassword: "newSecret456"
            })
            .toBeUndefined();

        await alice.userPublic
            .login(aliceLoginData)
            .toBeError(InvalidCredentialsError)

        await alice.userPublic
            .login({username: aliceLoginData.username, password: "newSecret456"})
            .toMatchObject({user: aliceUserData})
    });

    // --------------------------------------------
    // blocked user tests
    // --------------------------------------------

    const blockedLoginData = Object.freeze({
        username: "blocked1",
        password: "passwordGG"
    })
    const blockedRegisterData = Object.freeze({
        username: "blocked1",
        email: "blocked@example.com",
        password: "passwordGG"
    })
    const blockedUserData = Object.freeze({
        id: "user-2",
        username: "blocked1",
        email: "blocked@example.com"
    });

    test('register blocked user', async () => {
        await alice.userPublic
            .register(blockedRegisterData)
            .toMatchObject({
                user: blockedUserData,
                token: expect.any(String)
            })
    });

    test('block the user', async () => {
        // Login as alice to get auth token (password was changed to "newSecret456" in earlier test)
        await alice.login({username: aliceLoginData.username, password: "newSecret456"});
        // Block the user
        await alice.blockerUser
            .blockUser({username: blockedLoginData.username, reason: "User is blocked"})
            .toBeUndefined()
    });

    test('login blocked user', async () => {
        await alice.userPublic
            .login(blockedLoginData)
            .toBeError(FORBIDDEN)
    })

    test('login blocked user - with spy', async () => {
        await alice.userPublic
            .login(blockedLoginData)
            .toBeError(FORBIDDEN)
            .with(BlockerApi.spy.checkBlock
                .toMatchObject({username: blockedLoginData.username})
                .response.toMatchObject({blocked: true, reason: "User is blocked"})
            )
    })

    test('login blocked user - mock returns error', async () => {
        await alice.userPublic
            .login(blockedLoginData)
            .with(BlockerApi.mock.checkBlock
                .toMatchObject({username: blockedLoginData.username})
                .andReturn(new NOT_AUTHORIZED())
            )
            .toBeError(SERVER_ERROR)
    });

    test('login blocked user - mock overwrites', async () => {
        await alice.userPublic
            .login(blockedLoginData)
            .with(BlockerApi.mock.checkBlock
                .toMatchObject({username: blockedLoginData.username})
                .andReturn({blocked: false})
            )
            .toMatchObject({user: blockedUserData, token: expect.any(String)});
    });

});
