import {SqlQuery} from "../../src";

export async function exec<Result>(query: SqlQuery<Result>): Promise<Result[]> {
    return [{} as any];
}

export async function execOne<Result>(query: SqlQuery<Result>): Promise<Result> {
    return {} as any;
}
