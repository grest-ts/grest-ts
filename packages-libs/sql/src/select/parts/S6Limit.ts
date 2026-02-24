import {ExecMethods} from "./S7Exec";

export interface LimitMethods<Result> extends ExecMethods<Result> {
    noLimit(): ExecMethods<Result>

    limit(limit: number | [number, number]): ExecMethods<Result>

    limit1(): ExecMethods<Result>
}
