import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";
import {SQL} from "../src/SQL";
import {execOne} from "./tables/exec";

test("simple", async () => {

    const input: { userId: tUserId } = {userId: 10 as tUserId}

    const c = MyDb.user.as("c")
    const c2 = MyDb.user.as("c2")
    const s = MyDb.user.as("s")

    const scalarSub = SQL
        .uses(c)
        .selectFrom(s)
        .columns(s.id)
        //.where(["a","b"])
        .where(
            c.id.eq(c.id),
            s.id.eq(c.id)
        )
        .noLimit()
        .asScalar("subColumn");

    const joinSub = SQL
        .uses(c, c2)
        .selectFrom(s)
        .columns(s.id, s.id.as("subIdRenamed"))
        .where(
            s.id.eq(c.id),
            c2.id.eq(s.id)
        )
        .noLimit()
        .as("joinSub")

    const query = SQL
        .selectFrom(c)
        .join(c2, c2.id.eq(c.id))
        .leftJoin(joinSub, joinSub.id.eq(c.id))
        .columns(
            c.id,
            joinSub.id.as("subId"),
            scalarSub,
        )
        .where(
            c.id.eq(input.userId),
            c.username.isNull(),
            c.id.eq(input.userId),
            c.id.in(scalarSub)
        )
        .noLimit()

    console.log(query.toString())

    const res = await execOne(query);
    console.log(
        res.subColumn, // type tUserId
        res.id,  // type tUserId
        res.subId,  // type tUserId
    )

});
