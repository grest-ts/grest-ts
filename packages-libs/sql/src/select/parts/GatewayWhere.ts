import {ExecMethods} from "./S7Exec";
import {OrderByStructure} from "../../Types";


export interface GatewayWhereMethods<Entity, Result> {

    where(where: Partial<Entity>): GatewaySelectGroupByMethods<Entity, Result> & GatewaySelectOrderByMethods<Entity, Result> & GatewaySelectLimitMethods<Result> & ExecMethods<Result>

}

export interface GatewaySelectGroupByMethods<Entity, Result> extends GatewaySelectLimitMethods<Result> {

    groupBy(...fields: (keyof Entity)[]): GatewaySelectOrderByMethods<Entity, Result> & GatewaySelectLimitMethods<Result> & ExecMethods<Result>

}

export interface GatewaySelectOrderByMethods<Entity, Result> extends GatewaySelectLimitMethods<Result> {

    orderBy(...fields: OrderByStructure<keyof Entity>): GatewaySelectLimitMethods<Result> & ExecMethods<Result>

}

export interface GatewaySelectLimitMethods<Result> {

    noLimit(): ExecMethods<Result>

    limit(limit: number | [number, number]): ExecMethods<Result>

    limit1(): ExecMethods<Result>

}