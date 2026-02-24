import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";
import {AND, DATE, IF, OR, VALUE} from "../src";
import {SQL} from "../src/SQL";

test("simple", async () => {

    async function createQuery() {

        const input: { userId: tUserId } = {userId: 10 as tUserId}

        const c = MyDb.user.as("c")
        const c2 = MyDb.user.as("c2")
        const s = MyDb.user.as("s")

        const query = SQL
            .selectFrom(c)
            .join(c2, c2.id.eq(c.id))
            .distinct()
            .columns(
                SQL.uses(c).selectFrom(s).columns(s.id).where(s.id.eq(c.id)).limit(10).asScalar("subColumn"),
                c.username,
                c.id,
                c.id.as("renamedId"),
                VALUE(null as string).as("emptyValue"),
                DATE(c.created).as("myDate"),
                IF(
                    c.id.eq(10 as tUserId),
                    c.id,
                    c2.id
                ).as("userIdFromIf"),
                OR(
                    c.username.isNull(),
                    c.username.notNull(),
                    c.username.isNull()
                ).as("or"),
                AND(
                    c.username.isNull(),
                    c.username.notNull(),
                    c2.username.isNull()
                ).as("and")
            )
            .where(AND(
                c.id.eq(input.userId),
                c.username.isNull(),
                c.username.isNull(),
                c.username.notNull()
            ))
            .groupByF(r => [r.renamedId, c.id])
            .orderByF(r => [r.renamedId, c.id])
            .noLimit()
        String(query);
    }

    const amount = 100000;
    const time = performance.now();
    for (let i = 0; i < amount; i++) {
        await createQuery();
    }
    const total = performance.now() - time;
    console.log("Took: " + total.toFixed(2) + " ms (" + amount + " runs) \n" +
        "Per query: " + (total / amount).toFixed(6) + " ms"
    )

});
