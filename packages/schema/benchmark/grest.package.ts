import {definePackage} from "#scripts/packager/definePackage.ts";

definePackage({
    name: "@grest-ts/schema-benchmark",
    description: "Validation library benchmark suite",
    publishToNpm: true,
    keywords: ["benchmark", "validation", "performance"],
    targets: {node: true},
    hidden: true,
    compilerOptions: {
        "strict": true,
    },
    scripts: {
        "typia:generate": "typia generate --input src/libraries/typia/input --output src/libraries/typia/generated --project src/tsconfig.json",
        "tsrc:generate": "tspc -p src/libraries/ts-runtime-checks/tsconfig.json && node -e \"const f='src/libraries/ts-runtime-checks/generated/types.js';require('fs').writeFileSync(f,require('fs').readFileSync(f,'utf8').replace(/^import.*from .ts-runtime-checks.;\\n/gm,''))\"",
        "ajv:generate": "tsx src/libraries/ajv/generate.ts",
        "generate": "npm run typia:generate && npm run tsrc:generate && npm run ajv:generate",
        "benchmark": "npm run generate && tsx src/benchmark.ts"
    },
    dependencies: {
        "@sinclair/typebox": "^0.34.48",
        "commander": "^14.0.3",
        "arktype": "^2.1.29",
        "cbor-x": "^1.6.0",
        "msgpackr": "^1.11.8",
        "typia": "^11.0.3",
        "zod": "^4.3.6",
        "ajv": "^8.18.0",
        "valibot": "^1.2.0",
        "turbo-json-parse": "^2.3.0",
        "ts-runtime-checks": "^0.6.2",
        "ts-patch": "^3.3.0",
        "protobufjs": "^7.4.0"
    }
})
