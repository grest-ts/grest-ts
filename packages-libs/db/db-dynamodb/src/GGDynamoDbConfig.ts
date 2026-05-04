import {GGResource, GGSecret} from "@grest-ts/config";
import {GGDynamoDb} from "./GGDynamoDb";
import {IsObject, IsString} from "@grest-ts/schema";
import {GGLocatorKey} from "@grest-ts/locator";

// Every field optional — the AWS SDK has its own resolution chain for
// region (env var, shared profile, EC2 IMDS, ...) and credentials
// (IAM role, env vars, profile, ...). Forcing them at the framework
// layer duplicates work the SDK already does and forces boilerplate
// in deployments that should be zero-config.
//
// Set values to override the SDK defaults — e.g. dev points
// `endpoint` at dynamodb-local; multi-region apps set `region`; rare
// cases pass explicit credentials. AWS-native deployments
// (Beanstalk, ECS, Lambda, EC2) typically need none of this.
const IsDynamoDbResource = IsObject({
    region: IsString.orUndefined,
    endpoint: IsString.orUndefined,
});
export type GGDynamoDbHostData = typeof IsDynamoDbResource.infer

const IsDynamoDbUserData = IsObject({
    accessKeyId: IsString.orUndefined,
    secretAccessKey: IsString.orUndefined,
});
export type GGDynamoDbUserData = typeof IsDynamoDbUserData.infer

export class GGDynamoDbConfig {

    public readonly name: string;
    public readonly token: GGLocatorKey<GGDynamoDb>;
    public readonly host: GGResource<GGDynamoDbHostData | undefined>;
    public readonly user: GGSecret<GGDynamoDbUserData | undefined>;

    constructor(name: string) {
        this.name = name;
        this.token = new GGLocatorKey<GGDynamoDb>(`DynamoDb:${name}`);
        this.host = new GGResource(name + "/host", IsDynamoDbResource.orUndefined, "DynamoDB host configuration (optional — SDK self-configures from env/IMDS when absent)")
        this.user = new GGSecret(name + "/user", IsDynamoDbUserData.orUndefined, "DynamoDB user credentials (optional — SDK uses IAM role / default chain when absent)")
    }

    public newDynamoDb(): GGDynamoDb {
        return new GGDynamoDb(this);
    }
}
