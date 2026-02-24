import {GGResource, GGSecret} from "@grest-ts/config";
import {GGMysql} from "./GGMysql";
import {IsNumber, IsObject, IsString} from "@grest-ts/schema";
import {GGLocatorKey} from "@grest-ts/locator";

const IsMysqlResource = IsObject({
    host: IsString.orUndefined,
    port: IsNumber.orUndefined,
    database: IsString,
    connectionLimit: IsNumber.orUndefined
});
export type GGMysqlHostData = typeof IsMysqlResource.infer

const IsMysqlUserData = IsObject({
    username: IsString.orUndefined,
    password: IsString.orUndefined
});
export type GGMysqlUserData = typeof IsMysqlUserData.infer

export class GGMysqlConfig {

    public readonly name: string;
    public readonly token: GGLocatorKey<GGMysql>;
    public readonly host: GGResource<GGMysqlHostData>;
    public readonly user: GGSecret<GGMysqlUserData>;
    public readonly schemaFile?: string;

    constructor(name: string, schemaFile?: string) {
        this.name = name;
        this.token = new GGLocatorKey<GGMysql>(`Mysql:${name}`);
        this.host = new GGResource(name + "/host", IsMysqlResource, "Mysql host configuration")
        this.user = new GGSecret(name + "/user", IsMysqlUserData, "Mysql user credentials")
        this.schemaFile = schemaFile;
    }

    public newMysqlPool() {
        return new GGMysql(this);
    }
}
