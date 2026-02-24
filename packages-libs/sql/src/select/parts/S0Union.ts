import {ExecMethods} from "./S7Exec";
import {GroupByMethods} from "./S3GroupBy";

export interface UnionMethods<Result> {

    union<Exec, MergedResult = Merge<Result, Exec>>(
        table: Check<Result, Exec> & Exec
    ): UnionMethods<MergedResult> & GroupByMethods<MergedResult, {}>


    unionAll<Exec, MergedResult = Merge<Result, Exec>>(
        table: Check<Result, Exec> & Exec
    ): UnionMethods<MergedResult> & GroupByMethods<MergedResult, {}>
}

type Check<Result1, Exec> = Exec extends ExecMethods<infer Result2>
    ? Key1Checker<Result1, Result2> extends never
        ? Key2Checker<Result1, Result2> extends never
            ? Exec
            : Key2Checker<Result1, Result2>
        : Key1Checker<Result1, Result2>
    : never

type Key1Checker<Result1, Result2> = {
    [K in keyof Result1]: K extends keyof Result2
        ? never
        : `Missing column '${K extends string ? K : "???"}' on added union table! (...,${K extends string ? K : "???"}) UNION (..., ${K extends string ? K : "???"} <- Missing!)
                                                                                                                                                                                                                                                                                         `
    // Empty line is intentional to have only this message as an Error and no obejct comparison.
}[keyof Result1]

type Key2Checker<Result1, Result2> = {
    [K in keyof Result2]: K extends keyof Result1
        ? never
        : `Column '${K extends string ? K : "???"}' does not exist in previous queries! (...) UNION (...,'${K extends string ? K : "???"}' <--- is a mistake (or add it to previous queries)!)
                                                                                                                                                                                                                                                                                         `
    // Empty line is intentional to have only this message as an Error and no obejct comparison.
}[keyof Result2]


type Merge<Result, Exec> = Exec extends ExecMethods<infer Result2> ? {
    [K in keyof Result]: K extends keyof Result2 ? Result[K] | Result2[K] : never
} : never;
