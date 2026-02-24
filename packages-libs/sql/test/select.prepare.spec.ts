import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";
import {tCompanyId} from "./tables/Company";
import {IF, OR} from "../src";
import {SQL} from "../src";
import {execOne} from "./tables/exec";


interface Arguments {
    id: tUserId;
    companyId: tCompanyId;
    search: string
    age: number
}

test("prepare", async () => {

    // lazy prepare, prepares actually after first call.
    const preparedQuery = SQL.prepare((args: Arguments) => {
        const c = MyDb.user.as("c")

        const cond = c.age.eq(args.age)

        const sub = SQL
            .selectFrom(c)
            .columns(c.id, c.username, IF(c.id.eq(10 as tUserId), args.age, args.id).as("weird"))
            .where(OR(
                c.username.like(args.search),
                c.created.like(args.search)
            ))
            .noLimit()
            .as("sub")

        return SQL
            .selectFrom(c)
            .join(sub, sub.id.eq(c.id))
            .columns(
                c.id,
                c.username,
            )
            .where(
                c.id.eq(args.id),
                cond
            )
            .noLimit()
    })

    const oftenCalled = async () => {
        const res = await execOne(preparedQuery({
            id: 10 as tUserId,
            companyId: 12 as tCompanyId,
            search: "aa",
            age: 1000
        }))
        console.log(
            res.id,
            res.username
        )
    }

    await oftenCalled(); // prepares
    await oftenCalled(); // uses prepared
    await oftenCalled(); // uses prepared

});
