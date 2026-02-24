import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";
import {BIN_TO_UUID, RANK, UNIX_TIMESTAMP} from "../src";
import {SQL} from "../src/SQL";
import {execOne} from "./tables/exec";

test("window2", async () => {

    const c = MyDb.user.as("c")
    const c2 = MyDb.user.as("c2")
    const s = MyDb.user.as("s")
    String(c2);
    String(s)
    /*

    const query = `WITH sorted_by_latest AS (SELECT *,
                                                        RANK() OVER (PARTITION BY tin ORDER BY updated_at DESC) AS latest
                                                 FROM ${TableNames.validationRequestTable}
                                                 WHERE type = ${this.db.escape(type)}
                                                   AND local_id IN (${this.db.escape(ids)}))
                       SELECT *,
                              BIN_TO_UUID(uuid)          AS uuid,
                              UNIX_TIMESTAMP(created_at) as created_at,
                              UNIX_TIMESTAMP(updated_at) as updated_at
                       FROM sorted_by_latest
                       WHERE latest = 1
                       ORDER BY created_at DESC`;



      WITH `sorted_by_latest` AS (SELECT
          `c`.`id` as `id`,
          `c`.`created_at` as `created_at`,
          `c`.`updated_at` as `updated_at`,
          RANK() OVER (PARTITION BY `c`.`age` ORDER BY `c`.`created` desc) as `latest`
        FROM `user` as `c`
        WHERE `c`.`username` = 'asd'
       AND `c`.`age` IN( 1, 2, 3, 4)
    )

    SELECT
      `tbl`.`id` as `id`,
      BIN_TO_UINT(`tbl`.`id`) as `uuid`,
      UNIX_TIMESTAMP(`tbl`.`created_at`) as `created_at`,
      UNIX_TIMESTAMP(`tbl`.`updated_at`) as `updated_at`
    FROM `sorted_by_latest` as `tbl`
    WHERE `tbl`.`latest` = 1
    ORDER BY `tbl`.`created_at` desc

     */

    const sub = SQL.selectFrom(c)
        .columns(
            c.id,
            c.created_at,
            c.updated_at,
            RANK().over(f => f.partitionBy(c.age).orderBy(c.created, "desc")).as("latest"),
        )
        .where(
            c.username.eq("asd"), // type = ${this.db.escape(type)}
            c.age.in([1, 2, 3, 4] as tUserId[]) // local_id IN (${this.db.escape(ids)}))
        )
        .noLimit()
        .as("sorted_by_latest")
    const ref = SQL.createRef(sub, "tbl")

    const query = SQL
        .with(sub)
        .selectFrom(ref)
        .columns(
            ref.id,
            BIN_TO_UUID(ref.id).as("uuid"),
            UNIX_TIMESTAMP(ref.created_at),
            UNIX_TIMESTAMP(ref.updated_at)
        )
        .where(ref.latest.eq(1))
        .orderBy(ref.created_at, "desc")
        .noLimit()


    console.log(query.toString())

    const res = await execOne(query);
    console.log(
        res.id,  // type tUserId
    )

});
