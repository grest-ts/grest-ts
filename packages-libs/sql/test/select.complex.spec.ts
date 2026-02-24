import {tUserId} from "./tables/User";
import {DANGEROUS_SQL_EXPRESSION, DATE, EQ, IF} from "../src/SqlFunctions";
import {MyDb} from "./tables/MyDb";
import {SQL} from "../src/SQL";
import {execOne} from "./tables/exec";
import {tDate} from "@grest-ts/schema";

test("complex", async () => {

    const c = MyDb.user.as("c")
    const cFake = MyDb.company.as("c")
    const c2 = MyDb.user.as("c2")
    const c3 = MyDb.user.as("c3")
    const c4 = MyDb.user.as("c4")
    const c5 = MyDb.user.as("c5")
    const s = MyDb.user.as("s")

    // NOTICE: It is very hard to mess up field names, as it most certainly means some hacking as you always reference fields from table objects.

    const withSub = SQL
        .selectFrom(s)
        .columns(s.id, s.created, s.username, s.age, s.id.as("subIdRenamed"))
        .where(s.id.eq(10 as tUserId))
        .noLimit()
        .as("withSub")
    const withSubSub1 = SQL.createRef(withSub, "withSubSub1");
    const withSubSub2 = SQL.createRef(withSub, "withSubSub2");

    const withSub2 = SQL
        .selectFrom(s)
        .columns(s.id, s.created, s.username, s.age, s.id.as("subIdRenamed"))
        .where(s.id.eq(10 as tUserId))
        .limit([0, 50])
        .as("withSub2")
    const withSub2Sub1 = SQL.createRef(withSub2, "withSub2Sub1")
    String(withSub2Sub1)

    const subQueryTable = SQL
        .uses(c)
        .selectFrom(s)
        .columns(
            s.id,
            s.username,
            s.id.as("subIdRenamed"),
        )
        .where(EQ(s.id, c.id))
        .noLimit()
        .as("sub")


    // const xxx1 = c.id.eq(10 as tUserId)
    // const xxx2 = Sql.eq(Sql.date(c2.username), "2024.03.09" as vDate) // ____ERROR - wrong type DATE(c.name) = '2024.03.09',
    // const xxx3 = c.id.eq(10) // ____ERROR, 10 is not tUser
    // const xxx4 = Sql.eq(c.id, 10)  // ____ERROR, as 10 is not tUserId
    // const xxx5 = Sql.eq(c.id, cFake.id)  // ____ERROR, as tUser can't be applied over tCompanyId
    // const xxx5 = c.id.eq(cFake.id)  // ____ERROR, as tUser can't be applied over tCompanyId
    // const xxx6 = c.id.eq(12 as tCompanyId)  // ____ERROR, as tUser can't be applied over tCompanyId
    // const xxx7 = Sql.if(c.age.eq(10), c.age, 10).as("X0");
    // const xxx8 = Sql.if(c.age.eq(10), "a", "b").as("X0");
    // const xxx09 = Sql.in(c.age, [1, 2, 3, 4]).as("X0");
    // const sa = db.select().from(c).columns(c.age).noWhere().noLimit().asScalar("c");
    // const xxx10 = Sql.in(10, sa).as("X0");
    // const xxx11 = Sql.in(c.id, sa).as("X0");
    // const xxx12 = Sql.in(10, [1, 2, 3, 4]).as("X0");
    // const xxx13 = Sql.date(c.created)

    const query = SQL
        .with(withSub)
        .selectFrom(c)
        .join(c2, c2.id.eq(c.id))
        .join(subQueryTable, subQueryTable.subIdRenamed.eq(c.id))
        .leftJoin(withSubSub1, withSubSub1.id.eq(c.id))
        .leftJoin(withSubSub2, withSubSub2.id.eq(c.id))

        // .join(cFake, cFake.id.eq(c.id)) // ____ERROR, alias c is already used!
        // .join(c2, c2.id.eq(c.id)) // ____ERROR, c2 already joined
        // .join(c4, c.id.eq(c.id)) // ____ERROR, join condition should use arguments from joined table
        // .join(subQueryTable, subQueryTable.subIdRenamed.eq(c.id)) // ____ERROR, alias is already used!
        // .leftJoin(withSub, withSub.id.eq(c.id)) // ____ERROR, alias is already in use.
        // .leftJoin(withSub2Sub1, withSub2Sub1.id.eq(c.id)) // ____ERROR, not referenced in with part.

        .columns(
            c.id,
            subQueryTable.id.as("sId"),
            subQueryTable.subIdRenamed.as("subIdRenamedAgain"),
            c.id.as("renamedId"),
            DATE(c.created).as("myDate"),
            c.id.compare("<=", c2.id).as("expr1"),
            c.id.compare(">", c2.id).as("expr2"),
            DANGEROUS_SQL_EXPRESSION({I_DID_NOT_USE_UNSAFE_VARIABLES_TO_CONSTRUCT_THIS_STRING: ["100 + ROUND(", c.id, " > ", c2.id, ")"]}).cast<number>().as("expr3"),
            IF(c.id.eq(c2.id), c.username, c2.username).cast<string>().as("expr4"),
            withSubSub1.subIdRenamed.as("withSubSub1"),
            withSubSub2.subIdRenamed.as("withSubSub2"),

            IF(c.id.eq(10 as tUserId), c.id, 10 as tUserId).as("X0"),
            SQL.uses(c).selectFrom(s).columns(s.id).where(EQ(c.id, s.id)).noLimit().asScalar("someItem"),
            SQL.uses(c)
                .selectFrom(s)
                .columns(
                    s.id,
                    //s.username // ___ERROR - Scalar subquery allows only 1 column!
                )
                .where(s.id.eq(c.id)).noLimit().asScalar("subColumn"),

            // c.id, // ____ERROR, can't add same field twice!
            // DATE_DIFF(NOW(), c.created), // ____ERROR, Is missing column name
            // subQueryTable.id.as("sId"), // ____ERROR, Can't add same field twice!
            // cFake.name, // ____ERROR, table X is not used in the query
            // c3.username, // ____ERROR, table X is not used in the query
            // CONCAT(cFake.name, c2.username).as("concated"), // ____ERROR, table company as c,c2 is not used in the query (twice!)
            // withSub2Sub1.subIdRenamed.as("xxxx") // ____ERROR, not used in this query.
        )

        .where(
            c.id.eq(10 as tUserId),
            c.id.eq(c2.id),
            DATE(c.created).compare(">=", "2024.03.09" as tDate),
            c.id.eq(10 as tUserId),
            c.id.eq(c2.id),
            c.id.compare(">=", c2.id),

            // cFake.name.eq("as"), // ____ERROR, company as c is not referenced
            // c3.username.eq("aa"),  // ____ERROR, c3 is not referenced
            // Sql.eq(c3.username, "aa"), // ____ERROR, c3 is not referenced
            // Sql.and(c3.username.eq("a"), cFake.name.eq("a"), c4.username.eq("a")), // ____ERROR, c3, company as c, c4 is not referenced

        )

        .groupBy(c.id, c.username) // OK
        // .groupByF(r => [c.id, r.id])  // OK
        // .groupBy(c.username, c3.id) // ____ERROR, c3 is not referenced
        // .groupByF(r => [c.username, r.renamedId, c3.id]) // ____ERROR, c3 is not referenced

        // .having(c.id.eq(10 as tUserId))  // OK
        // .havingF(r => [c.id.eq(10 as tUserId), r.expr2.isNull()])  // OK
        // .havingF(r => [Sql.concat(r.expr2, r.expr1).eq("adfadf")]) // OK
        // .having(c.username) // ____ERROR, expression should be of Boolean type.
        // .havingF(r => [r.renamedId]) // ____ERROR, expression should be of Boolean type.
        // .having(c3.id.eq(10 as tUserId)) // ____ERROR, c3 is not referenced
        // .havingF(r => [Sql.concat(r.expr2, c.username, c3.username, c4.username).eq("adfadf")]) //  ____ERROR, c3,c4 is not referenced

        // .orderBy(c.id, "asc", c.username, "desc") // OK
        // .orderByF(r => [r.expr1, c.id, "asc", c.id, "desc"]) // OK
        // .orderByF(r => [r.expr1, c.id, "asc", c.id, "desc", c3.username, c4.username]) //  ____ERROR, c3,c4 is not referenced
        .noLimit()

    console.log(query.toString())

    const res = await execOne(query)
    console.log(
        res.id, // type tUserId
        res.renamedId,  // type tUserId
        res.myDate, // type vDateTime
        res.someItem, // tUserId
        res.sId,
        res.subIdRenamedAgain,
        res.subColumn,
        res.expr1,
        res.expr2,
        res.expr3,
        res.expr4,
        res.withSubSub1,
        res.withSubSub2,
        // res.name2,  // ____ERROR - no such field returned. (it shows white because upper query has errors, would be red otherwise.)
    )

    String(c3)
    String(c4)
    String(c5)
    String(cFake)

});
