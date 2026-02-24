import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";

interface Ctx {
    name: string;
}

test("short", async () => {
    const input: { userId: tUserId } = {userId: 10 as tUserId}

    const executor = <Result>(sql: string, ctx: Ctx): Promise<Result> => {
        return [{}] as any;
    }

    const query1 = MyDb.user
        .select("username", "id")
        .where({username: "tere", id: input.userId})
        .groupBy("username")
        .limit(1);
    console.log(query1.toSqlString())
    const res1 = await query1.execOne(executor, {name: "ha"});

    console.log(
        res1.username,
        res1.id
    )

});

