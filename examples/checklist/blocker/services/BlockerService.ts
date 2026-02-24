import type {GGPostgres, QueryResultRow} from "@grest-ts/db-postgre";
import {BlockCheckRequest, BlockCheckResponse, BlockerApiContract, BlockUserRequest} from "../../common/api-internal/BlockerApi";
import {BlockerUserApiContract} from "../../common/api-user/BlockerUserApi";
import {GGContractImplementation} from "@grest-ts/schema";

interface BlockedUserRow extends QueryResultRow {
    username: string;
    reason: string | null;
}

export class BlockerService implements GGContractImplementation<typeof BlockerApiContract["methods"]>, GGContractImplementation<typeof BlockerUserApiContract["methods"]> {
    private readonly db: GGPostgres;

    constructor(db: GGPostgres) {
        this.db = db;
    }

    public async checkBlock(request: BlockCheckRequest): Promise<BlockCheckResponse> {
        const rows = await this.db.query<BlockedUserRow>(
            'SELECT username, reason FROM blocked_users WHERE username = $1',
            [request.username]
        );

        if (rows.length > 0) {
            return {
                blocked: true,
                reason: rows[0].reason ?? "User is blocked"
            };
        }

        return {
            blocked: false,
            reason: undefined
        };
    }

    public async blockUser(request: BlockUserRequest): Promise<void> {
        await this.db.execute(
            'INSERT INTO blocked_users (username, reason) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET reason = EXCLUDED.reason',
            [request.username, request.reason ?? null]
        );
    }
}
