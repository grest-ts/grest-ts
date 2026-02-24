import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";
import {SQL} from "../src/SQL";
import {execOne} from "./tables/exec";

test("with", async () => {

    const input: { userId: tUserId } = {userId: 10 as tUserId}

    const c = MyDb.user.as("c")
    const c2 = MyDb.user.as("c2")
    const s = MyDb.user.as("s")

    const part1 = SQL
        .selectFrom(s)
        .columns(s.id, s.id.as("subIdRenamed"))
        .where(s.id.eq(10 as tUserId))
        .noLimit()
        .as("part1")
    const pA1 = SQL.createRef(part1, "part1Sub1");
    const pA2 = SQL.createRef(part1, "part1Sub2");

    const part2 = SQL
        .selectFrom(s)
        .columns(s.id)
        .noWhere()
        .noLimit()
        .as("part2")
    const pB1 = SQL.createRef(part2, "part2Sub1")

    const query = SQL
        .with(part1, part2)
        .selectFrom(c)
        .join(c2, c2.id.eq(c.id))
        .join(pA1, pA1.id.eq(c.id))
        .join(pA2, pA2.id.eq(c.id))
        .join(pB1, pB1.id.eq(c.id))
        .columns(
            c.id,
            pA1.id.as("aa1"),
            pA1.subIdRenamed.as("aa1X"),
            pA2.id.as("aa2"),
            pB1.id.as("aa3"),
        )
        .where(
            c.id.eq(input.userId),
            pB1.id.eq(input.userId)
        )
        .noLimit()


    console.log(query.toString())

    const res = await execOne(query);
    console.log(
        res.id,  // type tUserId
        res.aa1X,
        res.aa1,
        res.aa2,
        res.aa3
    )

});
