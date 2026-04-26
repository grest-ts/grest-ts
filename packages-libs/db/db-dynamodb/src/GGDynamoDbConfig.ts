import {GGResource, GGSecret} from "@grest-ts/config";
import {GGDynamoDb} from "./GGDynamoDb";
import {IsObject, IsString} from "@grest-ts/schema";
import {GGLocatorKey} from "@grest-ts/locator";

const IsDynamoDbResource = IsObject({
    region: IsString,
    // Empty / undefined = real AWS. Set for dynamodb-local / localstack.
    endpoint: IsString.orUndefined,
});
export type GGDynamoDbHostData = typeof IsDynamoDbResource.infer

const IsDynamoDbUserData = IsObject({
    // Both fields optional. When either is missing, the SDK falls back
    // to its default credential chain (IAM role on EC2/Beanstalk, env
    // vars, shared profile, ...).
    accessKeyId: IsString.orUndefined,
    secretAccessKey: IsString.orUndefined,
});
export type GGDynamoDbUserData = typeof IsDynamoDbUserData.infer

export class GGDynamoDbConfig {

    public readonly name: string;
    public readonly token: GGLocatorKey<GGDynamoDb>;
    public readonly host: GGResource<GGDynamoDbHostData>;
    public readonly user: GGSecret<GGDynamoDbUserData>;

    constructor(name: string) {
        this.name = name;
        this.token = new GGLocatorKey<GGDynamoDb>(`DynamoDb:${name}`);
        this.host = new GGResource(name + "/host", IsDynamoDbResource, "DynamoDB host configuration")
        this.user = new GGSecret(name + "/user", IsDynamoDbUserData, "DynamoDB user credentials")
    }

    public newDynamoDb(): GGDynamoDb {
        return new GGDynamoDb(this);
    }
}
