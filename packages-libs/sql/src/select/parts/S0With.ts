import {AliasedTable, Key, NotUsingWithPart} from "../../Types";
import {JoinMethods} from "./S1Join";

export interface WithMethods<AliasesFromWith> {

    // with<
    //     Alias extends string,
    //     TableRef extends `${string} as ${Alias}`
    // >(
    //     table: isAliasAlreadyUsed<AliasesFromWith, Alias, AliasedTable<Alias, TableRef, object, NotUsingWithPart>>
    // ): WithMethods<AliasesFromWith & Key<Alias>>

    selectFrom<
        Alias extends string,
        TableRef extends `${string} as ${Alias}`
    >(
        table: AliasedTable<Alias, TableRef, object, object, string | NotUsingWithPart>
    ): JoinMethods<Key<Alias>, AliasesFromWith, Key<TableRef>>

}

