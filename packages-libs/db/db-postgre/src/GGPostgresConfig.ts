import {GGResource, GGSecret} from "@grest-ts/config";
import {GGPostgres} from "./GGPostgres";
import {IsNumber, IsObject, IsString} from "@grest-ts/schema";
import {GGLocatorKey} from "@grest-ts/locator";

const IsPostgresResource = IsObject({
    host: IsString.orUndefined,
    port: IsNumber.orUndefined,
    database: IsString,
    connectionLimit: IsNumber.orUndefined
});
export type GGPostgresHostData = typeof IsPostgresResource.infer

const IsPostgresUserData = IsObject({
    username: IsString.orUndefined,
    password: IsString.orUndefined
});
export type GGPostgresUserData = typeof IsPostgresUserData.infer

export class GGPostgresConfig {

    public readonly name: string;
    public readonly token: GGLocatorKey<GGPostgres>;
    public readonly host: GGResource<GGPostgresHostData>;
    public readonly user: GGSecret<GGPostgresUserData>;
    public readonly schemaFile?: string;

    constructor(name: string, schemaFile?: string) {
        this.name = name;
        this.token = new GGLocatorKey<GGPostgres>(`Postgres:${name}`);
        this.host = new GGResource(name + "/host", IsPostgresResource, "Postgres host configuration")
        this.user = new GGSecret(name + "/user", IsPostgresUserData, "Postgres user credentials")
        this.schemaFile = schemaFile;
    }

    public newPostgresPool() {
        return new GGPostgres(this);
    }
}
