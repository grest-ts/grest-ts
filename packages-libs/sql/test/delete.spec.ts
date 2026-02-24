import {tUserId} from "./tables/User";
import {MyDb} from "./tables/MyDb";
import {SQL} from "../src/SQL";

test("delete", async () => {

    const input: { userId: tUserId } = {userId: 10 as tUserId}

    const c = MyDb.user.as("c")
    const c2 = MyDb.user.as("c2")
    String(c2);

    const q1 = MyDb.user.deleteWhere({id: input.userId}).noLimit();
    console.log(q1.toString())

    const q2 = SQL.deleteFrom(c).where(c.id.eq(input.userId)).orderBy(c.id).limit(10)
    console.log(q2.toString())
    
    //SQL.deleteFrom(c).where(c2.id.eq(input.userId)).orderBy(c2.id).limit(10)

});
