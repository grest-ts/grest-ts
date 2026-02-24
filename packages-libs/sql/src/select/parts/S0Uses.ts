import {AliasedTable, Key, NotUsingWithPart} from "../../Types";
import {JoinMethods} from "./S1Join";

export interface UsesMethods<Aliases, Tables> {

    // uses<
    //     Alias extends string,
    //     TableRef extends `${string} as ${Alias}`
    // >(
    //     table: isAliasAlreadyUsed<Aliases, Alias, AliasedTable<Alias, TableRef, any, NotUsingWithPart>>
    // ): UsesMethods<Aliases & Key<Alias>, Tables & Key<TableRef>>


    selectFrom<
        Alias extends string,
        TableRef extends `${string} as ${Alias}`
    >(
        table: AliasedTable<Alias, TableRef, object, object, string | NotUsingWithPart>
    ): JoinMethods<Aliases & Key<Alias>, {}, Tables & Key<TableRef>>

}
