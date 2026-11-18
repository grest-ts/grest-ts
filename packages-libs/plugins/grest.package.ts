import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/plugins",
    description: "Plugins for an app with several runtimes: typed extension points, dependency order, enablement, and generated registries",
    keywords: ["plugins", "extension-points", "slots", "registry", "codegen"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    allowedPackages: [],
    customExports: {
        "./react": "./src/react/index.ts",
        "./gen": "./src/gen/GGPluginGen.ts",
    },
    peerDependencies: {
        "react": "^19",
    },
    compilerOptions: {
        "lib": ["ES2022", "DOM"],
        "jsx": "react-jsx",
    },
})
