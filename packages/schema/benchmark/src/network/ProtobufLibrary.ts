import protobuf from 'protobufjs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import * as fs from 'fs';
import {GGBenchTestCases, TestRunner, SKIP, SkipType} from "../lib/TestRunner";
import GGTypeAOT from "../libraries/gg-type/GGTypeAOT";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedRoot: protobuf.Root | null = null;

// Synchronous schema loading using parse instead of loadSync
function loadSchemaSync(): protobuf.Root {
    if (cachedRoot) return cachedRoot;
    const protoPath = path.join(__dirname, './protobuf/schemas.proto');
    const protoContent = fs.readFileSync(protoPath, 'utf-8');
    cachedRoot = protobuf.parse(protoContent).root;
    return cachedRoot;
}

/**
 * Protobuf library with validation.
 */
class ProtobufTester extends TestRunner {
    private readonly messageType: protobuf.Type;
    private readonly validator: TestRunner;

    constructor(messageType: protobuf.Type, validator: TestRunner) {
        // For protobuf, network input is pre-encoded binary
        // Note: wrongObj may have invalid types that protobuf can't encode, so we use correctObj for both
        super((correctObj, _wrongObj) => {
            return {
                correctNetworkInput: messageType.encode(messageType.create(correctObj)).finish(),
                wrongNetworkInput: messageType.encode(messageType.create(correctObj)).finish()
            };
        });
        this.messageType = messageType;
        this.validator = validator;
    }

    before(): void {}

    test_is(obj: unknown): boolean | SkipType {
        const result = this.validator.test_is(obj);
        return result !== SKIP && result === true;
    }

    test_parse(obj: any): any | undefined {
        try {
            const decoded = this.messageType.decode(obj);
            return this.validator.test_parse(decoded);
        } catch {
            return undefined;
        }
    }

    test_string(_str: string | undefined): SkipType {
        // Network libraries don't use string - they use binary _parse
        return SKIP;
    }

    test_stringify(obj: any): any | undefined {
        try {
            const cleaned = this.validator.test_parse(obj);
            if (cleaned === undefined) return undefined;
            const message = this.messageType.create(cleaned);
            return this.messageType.encode(message).finish();
        } catch {
            return undefined;
        }
    }

    test_errorPaths(obj: unknown): string[] | SkipType {
        return this.validator.test_errorPaths(obj);
    }
}

// Load protobuf types
const root = loadSchemaSync();
const SimpleType = root.lookupType("SimpleData");
const NestedType = root.lookupType("NestedData");
const RefineType = root.lookupType("RefineData");
const BigStringType = root.lookupType("BigStringData");
const DiscriminatedUserType = root.lookupType("DiscriminatedUser");

// Note: number/recursive/tuple/bigArray are disabled due to protobuf limitations
export default {
    number: undefined, // Protobuf doesn't have standalone number type
    simple: new ProtobufTester(SimpleType, GGTypeAOT.simple!),
    nested: new ProtobufTester(NestedType, GGTypeAOT.nested!),
    refine: new ProtobufTester(RefineType, GGTypeAOT.refine!),
    discriminated: new ProtobufTester(DiscriminatedUserType, GGTypeAOT.discriminated!),
    recursive: undefined, // Protobuf handles recursive differently
    tuple: undefined, // Protobuf doesn't support tuples natively
    bigString: new ProtobufTester(BigStringType, GGTypeAOT.bigString!),
    bigArray: undefined // Would need proto schema
} satisfies GGBenchTestCases;
