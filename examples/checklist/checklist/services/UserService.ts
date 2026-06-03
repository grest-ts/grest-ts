import {EXISTS, FORBIDDEN, GGContractClient, GGContractImplementation, NOT_AUTHORIZED, NOT_FOUND, SERVER_ERROR} from "@grest-ts/schema"
import {BadUsernameError, InvalidCredentialsError, LoginRequest, LoginResponse, RegisterRequest, UserPublicApiContract} from "../../common/api-user-public/UserPublicApi";
import {ChangePasswordRequest, UserAuthApiContract} from "../../common/api-user/UserAuthApi";
import {BlockerApiContract} from "../../common/api-internal/BlockerApi";
import {tUserAuthToken, tUserId, User} from "../../common/api-user/auth/UserAuth";
import {UserContext} from "../UserContext";
import type {GGPostgres, QueryResultRow} from "@grest-ts/db-postgre";
import {EventPublisherClient, GGEventApi} from "@grest-ts/events";
import {UserEventsContract} from "../../common/events/UserEvents";

interface UserRow extends QueryResultRow {
    id: string;
    username: string;
    email: string;
    password: string;
}

interface AuthTokenRow extends QueryResultRow {
    token: string;
    user_id: string;
}

interface MaxIdRow extends QueryResultRow {
    max_id: number | null;
}

export class UserService implements GGContractImplementation<typeof UserPublicApiContract["methods"]>, GGContractImplementation<typeof UserAuthApiContract["methods"]> {
    private readonly db: GGPostgres;
    private readonly blockerClient: GGContractClient<typeof BlockerApiContract["methods"]>;
    private readonly userEvents: EventPublisherClient<GGEventApi<typeof UserEventsContract["methods"]>>;

    constructor(db: GGPostgres, blockerClient: GGContractClient<typeof BlockerApiContract["methods"]>, userEvents: EventPublisherClient<GGEventApi<typeof UserEventsContract["methods"]>>) {
        this.db = db;
        this.blockerClient = blockerClient;
        this.userEvents = userEvents;
    }

    private async checkIfBlocked(username: string) {
        const result = await this.blockerClient.checkBlock({username: username}).asResult()
        if (result.success === true) {
            if (result.data.blocked) {
                throw new FORBIDDEN({
                    displayMessage: result.data.reason || "User is blocked"
                })
            }
        } else {
            throw new SERVER_ERROR({displayMessage: "Failed to check block status"})
        }
    }

    public async register(request: RegisterRequest): Promise<LoginResponse> {
        // Check for bad username (test scenario)
        if (request.username === "baduser") {
            throw new BadUsernameError({reason: "Username 'baduser' is not allowed"})
        }

        // Check if username already exists
        const existing = await this.db.query<UserRow>(
            'SELECT id FROM users WHERE username = $1',
            [request.username]
        );
        if (existing.length > 0) {
            throw new EXISTS();
        }

        // Get next user ID (maintaining the "user-{n}" format)
        const maxIdResult = await this.db.query<MaxIdRow>(
            `SELECT MAX(CAST(SUBSTRING(id, 6) AS INTEGER)) as max_id
             FROM users
             WHERE id LIKE 'user-%'`
        );
        const nextId = (maxIdResult[0]?.max_id ?? 0) + 1;
        const userId = `user-${nextId}` as tUserId;

        // Insert new user
        await this.db.execute(
            'INSERT INTO users (id, username, email, password) VALUES ($1, $2, $3, $4)',
            [userId, request.username, request.email, request.password]
        );

        // Generate and store token
        const token = await this.generateToken(userId);

        const publishResult = await this.userEvents.publish("registered", {
            userId,
            username: request.username,
            timestamp: Date.now(),
        }).asResult();

        if (!publishResult.success) {
            throw new SERVER_ERROR({displayMessage: "Failed to publish registration event"});
        }

        return {
            token,
            user: {
                id: userId,
                username: request.username,
                email: request.email
            }
        };
    }

    public async login(request: LoginRequest): Promise<LoginResponse> {
        const users = await this.db.query<UserRow>(
            'SELECT id, username, email, password FROM users WHERE username = $1',
            [request.username]
        );

        if (users.length === 0 || users[0].password !== request.password) {
            throw new InvalidCredentialsError();
        }

        const user = users[0];
        await this.checkIfBlocked(user.username);

        const token = await this.generateToken(user.id as tUserId);

        await this.userEvents.publish("loggedIn", {
            userId: user.id as tUserId,
            timestamp: Date.now()
        }).asResult();

        return {
            token,
            user: {
                id: user.id as tUserId,
                username: user.username,
                email: user.email
            }
        };
    }

    public async changePassword(request: ChangePasswordRequest): Promise<void> {
        const authUser = UserContext.assert();

        const users = await this.db.query<UserRow>(
            'SELECT id, username, password FROM users WHERE id = $1',
            [authUser.id]
        );

        if (users.length === 0) {
            throw new NOT_FOUND();
        }

        const user = users[0];
        if (user.password !== request.oldPassword) {
            throw new NOT_AUTHORIZED({
                displayMessage: "Invalid old password"
            });
        }

        await this.checkIfBlocked(user.username);

        await this.db.execute(
            'UPDATE users SET password = $1 WHERE id = $2',
            [request.newPassword, authUser.id]
        );

        await this.userEvents.publish("passwordChanged", {
            userId: authUser.id,
            timestamp: Date.now()
        }).asResult();
    }

    public async me(): Promise<User> {
        return UserContext.assert();
    }

    public async getUserByToken(token: tUserAuthToken): Promise<User | undefined> {
        const tokens = await this.db.query<AuthTokenRow>(
            'SELECT user_id FROM auth_tokens WHERE token = $1',
            [token]
        );

        if (tokens.length === 0) {
            return undefined;
        }

        const users = await this.db.query<UserRow>(
            'SELECT id, username, email FROM users WHERE id = $1',
            [tokens[0].user_id]
        );

        if (users.length === 0) {
            return undefined;
        }

        return {
            id: users[0].id as tUserId,
            username: users[0].username,
            email: users[0].email
        };
    }

    private async generateToken(userId: tUserId): Promise<tUserAuthToken> {
        const token = `token-${userId}-${Date.now()}` as tUserAuthToken;

        await this.db.execute(
            'INSERT INTO auth_tokens (token, user_id) VALUES ($1, $2)',
            [token, userId]
        );

        return token;
    }
}
