/**
 * AJV AOT Code Generator
 *
 * Generates standalone validation code at build time using ajv/dist/standalone.
 * This produces true AOT-compiled validators, unlike AjvCompiled.ts which uses JIT compilation.
 */
import Ajv from "ajv";
import standalone from "ajv/dist/standalone";
import * as fs from "fs";
import * as path from "path";
import {
    bigArraySchema,
    bigStringSchema,
    discriminatedSchema,
    nestedSchema,
    numberSchema,
    recursiveSchema,
    refineSchema,
    simpleSchema,
    tupleSchema
} from "./data";

const ajv = new Ajv({
    allErrors: true,
    removeAdditional: "all",
    discriminator: true,
    code: { source: true, esm: true }
});

// Compile all schemas and create export map
// For standalone, we need to pass { exportName: schemaKeyOrId }
const validators: Record<string, string> = {
    number: "numberSchema",
    simple: "simpleSchema",
    nested: "nestedSchema",
    refine: "refineSchema",
    discriminated: "discriminatedSchema",
    recursive: "recursiveSchema",
    tuple: "tupleSchema",
    bigString: "bigStringSchema",
    bigArray: "bigArraySchema"
};

// Add schemas with explicit $id for standalone to reference
ajv.addSchema({ ...numberSchema, $id: "numberSchema" });
ajv.addSchema({ ...simpleSchema, $id: "simpleSchema" });
ajv.addSchema({ ...nestedSchema, $id: "nestedSchema" });
ajv.addSchema({ ...refineSchema, $id: "refineSchema" });
ajv.addSchema({ ...discriminatedSchema, $id: "discriminatedSchema" });
// recursiveSchema already has $id: "recursiveData", so use that
ajv.addSchema(recursiveSchema);
ajv.addSchema({ ...tupleSchema, $id: "tupleSchema" });
ajv.addSchema({ ...bigStringSchema, $id: "bigStringSchema" });
ajv.addSchema({ ...bigArraySchema, $id: "bigArraySchema" });

// Override recursive key to use the existing $id
validators.recursive = "recursiveData";

// Compile all schemas first (required before standalone)
for (const schemaId of Object.values(validators)) {
    ajv.getSchema(schemaId);
}

// Generate standalone code for all validators
let code = standalone(ajv, validators);

// Post-process: Convert require() calls to ESM imports
// AJV standalone generates: const func2 = require("ajv/dist/runtime/ucs2length").default;
// We need: import _ucs2length from "ajv/dist/runtime/ucs2length"; const func2 = _ucs2length;
const requirePattern = /const (\w+) = require\("([^"]+)"\)\.default;/g;
const imports: string[] = [];
let importIndex = 0;

code = code.replace(requirePattern, (_match, varName, modulePath) => {
    const importName = `_ajvRuntime${importIndex++}`;
    // Add .js extension for ESM compatibility
    const esmPath = modulePath.endsWith('.js') ? modulePath : `${modulePath}.js`;
    imports.push(`import * as ${importName} from "${esmPath}";`);
    // AJV runtime modules have nested default exports: module.default.default
    return `const ${varName} = ${importName}.default.default || ${importName}.default;`;
});

// Remove "use strict" (not needed in ESM) and add imports at the top
code = code.replace(/^"use strict";/, '');
if (imports.length > 0) {
    code = imports.join('\n') + '\n' + code;
}

// Write to generated folder
const outDir = path.join(import.meta.dirname, "generated");
fs.mkdirSync(outDir, { recursive: true });

const outFile = path.join(outDir, "validators.js");
fs.writeFileSync(outFile, code);

// Create .gitignore if it doesn't exist
const gitignorePath = path.join(outDir, ".gitignore");
if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*.js\n");
}

console.log("Generated AJV AOT validators:", outFile);
