import {StructParser} from "../src/StructParser";
import * as path from "node:path";
import {diff} from "@vitest/utils/diff";
import {StructMeta} from "../src/StructMeta";

describe('collectStructDefinitions – integration', () => {

    let parsed: StructMeta[]

    const get = (clsName: string): StructMeta => {
        const found = parsed.find(e => e.name === clsName)
        if (!found) throw new Error("Struct not found: " + clsName)
        return found
    }

    beforeAll(() => {
        const sourceFile = path.dirname(__filename) + "/examples/";
        parsed = StructParser.parse(sourceFile);
    })

    const AddableStruct = "AddableStruct"
    it(AddableStruct, () => {
        compareObjects(get(AddableStruct), {
            name: AddableStruct,
            path: get(AddableStruct).path,
            idTsType: "tRef",
            idTsTypeDefinition: "export type tRef = number & { tRef: never };",
            useDirty: false,
            useExport: false,
            useNew: true,
            chunks: [
                {
                    sourceBits: 64, bits: 64, properties: [
                        {name: "x", type: "int16", offset: 0, bits: 16, addMath: true},
                        {name: "y", type: "int16", offset: 1, bits: 16, addMath: true},
                        {name: "spriteId", type: "uint32", offset: 1, mustExist: true, bits: 32, tsType: "tSpriteId", tsTypeImport: "./misc/MiscTypes"},
                    ]
                }
            ]
        })
    })

    const ComplexStruct = "ComplexStruct"
    it(ComplexStruct, () => {
        compareObjects(get(ComplexStruct), {
            name: ComplexStruct,
            path: get(ComplexStruct).path,
            idTsType: "tRef33",
            idTsTypeDefinition: "export type tRef33 = number & { tRef33: never };",
            useDirty: true,
            useExport: true,
            useNew: true,
            chunks: [
                {
                    sourceBits: 64, bits: 64, properties: [
                        {name: "x", type: "int16", addMath: true, offset: 0, bits: 16},
                        {name: "y", type: "int16", addMath: true, offset: 1, bits: 16},
                        {name: "width", type: "uint16", offset: 2, bits: 16},
                        {name: "height", type: "uint16", offset: 3, bits: 16}
                    ]
                },
                {
                    sourceBits: 82, bits: 96, properties: [
                        {name: "clickId", type: "uint32", offset: 0, bits: 32},
                        {name: "spriteId", type: "uint16", mustExist: true, offset: 2, bits: 16, tsType: "tSpriteId", tsTypeImport: "./misc/MiscTypes"},
                        {name: "tileX", type: "uint8", offset: 6, bits: 8},
                        {name: "tileY", type: "uint8", offset: 7, bits: 8},
                        {name: "opacity", type: "uint8", offset: 8, bits: 8},
                        {name: "isHighlighted", type: "bool", offset: 9, bits: 1, mask: 0b0000001},
                        {name: "isAnimated", type: "bit", offset: 9, bits: 1, mask: 0b0000010},
                        {name: "something", type: "int8", offset: 10, bits: 8, tsType: "MyEnum", tsTypeDefinition: "export type MyEnum = 10 | 20"},
                    ]
                }
            ]
        })
    });

});

function compareObjects(parsed: object, expected: object) {
    const res = diff(expected, parsed, {expand: false}) ?? "";
    if (res.indexOf("Compared values have no visual difference") === -1) {
        throw new Error(res);
    }
}