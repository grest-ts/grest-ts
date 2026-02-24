import fg from 'fast-glob';
import * as path from "node:path";
import * as fs from "node:fs";
import {CallExpression, NewExpression, Node, ObjectLiteralExpression, Project, PropertyAssignment, SourceFile, SyntaxKind} from 'ts-morph';
import {ChunkMeta, DataType, PropertyMeta, StructMeta} from "./StructMeta";
import {BuilderExportable} from "./BuilderExportable";

const TYPE_BITS: Record<string, 64 | 32 | 16 | 8 | 1> = {
    int8: 8,
    uint8: 8,
    int16: 16,
    uint16: 16,
    int32: 32,
    uint32: 32,
    float32: 32,
    float64: 64,
    bool: 1,
    bit: 1,
};

export class StructParser {

    private static SUFFIX = ".struct.ts";

    public static build(path: string, verbose: boolean = true) {
        if (path) {
            StructParser.parse(path).forEach((meta) => {
                const fileStr = BuilderExportable.build(meta);
                const filePath = meta.path.substring(0, meta.path.length - this.SUFFIX.length) + ".ts"
                const currentFileStr = String(fs.existsSync(filePath) ? fs.readFileSync(filePath) : "");
                if (currentFileStr !== fileStr) {
                    fs.writeFileSync(filePath, fileStr)
                    verbose && console.log(meta.name + " updated");
                } else {
                    verbose && console.log(meta.name + " already up to date");
                }
            })
        } else {
            throw new Error("Invalid path!");
        }
    }

    public static parse(cwd = process.cwd(), pattern = '**/*.struct.ts'): StructMeta[] {
        const files = fg.sync('**/*' + this.SUFFIX, {cwd, absolute: true});

        const project = new Project({
            // tsConfigFilePath: path.join(cwd, 'tsconfig.json'),
            skipFileDependencyResolution: true,
        });
        files.forEach(f => project.addSourceFileAtPath(f));

        return project.getSourceFiles()
            .flatMap(sf => {
                const structs: StructMeta[] = [];
                const news = sf.getDescendantsOfKind(SyntaxKind.NewExpression).filter(ne => isIdentifierCalled(ne.getExpression(), 'Struct'));
                for (const ne of news) structs.push(this.parseStruct(ne, sf));
                return structs;
            });
    }

    private static parseStruct(ne: NewExpression, sf: SourceFile): StructMeta {


        const args = ne.getArguments()[0] as ObjectLiteralExpression;
        const result: StructMeta = {
            name: path.basename(sf.getFilePath()).split(".").shift(),
            path: sf.getFilePath(),
            idTsType: undefined,
            idTsTypeDefinition: undefined,
            useDirty: readBooleanProperty(args, "useDirty") ?? false,
            useNew: readBooleanProperty(args, "useNew") ?? false,
            useExport: readBooleanProperty(args, "useExport") ?? false,
            chunks: []
        }

        const calls: CallExpression[] = [];
        let expr: Node = ne;
        while (true) {
            const pae = expr.getParent();
            if (!Node.isPropertyAccessExpression(pae)) break;
            const call = pae.getParent();
            if (!Node.isCallExpression(call)) break;
            calls.push(call);
            expr = call;
        }

        let currentChunk: ChunkMeta = freshChunk();

        for (const call of calls) {
            const method = call.getExpression().getLastToken()?.getText() ?? '';

            switch (method) {
                case 'ref': {
                    const typeArg = call.getTypeArguments()[0];
                    result.idTsType = typeArg?.getText() ?? result.idTsType;
                    const alias = sf.getTypeAlias(result.idTsType);
                    if (alias) {
                        result.idTsTypeDefinition = "export " + alias.getText();
                    }
                    break;
                }

                case 'buffer': {
                    if (currentChunk.properties.length) {
                        finalizeChunk(currentChunk);
                        result.chunks.push(currentChunk);
                    }
                    currentChunk = freshChunk();
                    break;
                }

                case 'struct': {
                    // @TODO Handle struct
                    break;
                }

                default: {
                    if (!(method in TYPE_BITS)) {
                        break;
                    }
                    const propName = literalArg(call, 0);
                    if (!propName) {
                        break;
                    }
                    const bits = TYPE_BITS[method];
                    const lastProp = currentChunk.properties[currentChunk.properties.length - 1];

                    if (bits !== 1 && lastProp && lastProp.bits === 1) {
                        // If this adds anything, it means we used bit/bool values.
                        currentChunk.bits += 8 - currentChunk.sourceBits % 8
                    }

                    const prop: PropertyMeta = {
                        name: propName,
                        type: method as DataType,
                        offset: Math.floor(currentChunk.bits / 8) / (TYPE_BITS[method] > 8 ? TYPE_BITS[method] / 8 : 1),
                        bits: TYPE_BITS[method],
                    };

                    /* optional 2nd arg: typed<tX>() */
                    const args = call.getArguments().length;
                    if (call.getArguments().length > 1) {
                        for (let i = 1; i < args; i++) {
                            const second = call.getArguments()[i];
                            const txt = second.getText();
                            const m = txt.match(/typed<([\w\d_]+)>\(\)/);

                            if (m) {
                                const typeName = m[1];
                                prop.tsType = typeName;

                                /* 1declared in this very file? */
                                const alias = sf.getTypeAlias(typeName);
                                const enm = sf.getEnum(typeName);
                                const iface = sf.getInterface(typeName);
                                const decl = alias ?? enm ?? iface;

                                if (decl) {
                                    prop.tsTypeDefinition = decl.getText().replace(/\r\n/g, '\n').trimEnd();
                                } else {
                                    /* otherwise look through the imports */
                                    const imp = sf.getImportDeclarations().find(id =>
                                        id.getNamedImports().some(ni => ni.getName() === typeName) ||
                                        id.getDefaultImport()?.getText() === typeName
                                    );
                                    if (imp) {
                                        prop.tsTypeImport = imp.getModuleSpecifierValue();
                                    }
                                }
                            } else if (txt === "ADD_MATH") {
                                prop.addMath = true;
                            } else if (txt === "MUST_EXIST") {
                                prop.mustExist = true;
                            }
                        }
                    }

                    /* bit masks for bool / bit fields on same byte */
                    if (prop.bits === 1) {
                        const byteOffsetBits = currentChunk.sourceBits & 7;
                        prop.mask = 1 << byteOffsetBits;
                    }

                    currentChunk.properties.push(prop);
                    currentChunk.sourceBits += prop.bits;
                    currentChunk.bits += prop.bits;
                    break;
                }
            }
        }

        if (currentChunk.properties.length) {
            finalizeChunk(currentChunk);
            result.chunks.push(currentChunk)
        }
        return result
    }

}

function readBooleanProperty(obj: ObjectLiteralExpression, propName: string): boolean | undefined {
    if (obj) {
        const prop = obj.getProperty(propName);
        if (prop && Node.isPropertyAssignment(prop)) {
            const init = (prop as PropertyAssignment).getInitializer();
            if (!init) return undefined;
            const text = init.getText();
            if (text === "true") return true;
            if (text === "false") return false;
        }
    }
    return undefined;
}

function freshChunk(): ChunkMeta {
    return {sourceBits: 0, bits: 0, properties: []};
}

function finalizeChunk(ch: ChunkMeta): void {
    let biggestSize = 8;
    for (let i = 0; i < ch.properties.length; i++) {
        if (ch.properties[i].bits > biggestSize) {
            biggestSize = ch.properties[i].bits;
        }
    }
    ch.bits = Math.ceil(ch.sourceBits / biggestSize) * biggestSize;
}

function literalArg(call: CallExpression, ix: number): string | null {
    const arg = call.getArguments()[ix];
    if (arg && Node.isStringLiteral(arg)) {
        return arg.getLiteralText();
    }
    return null;
}

function isIdentifierCalled(node: Node | undefined, name: string): boolean {
    return Node.isIdentifier(node) && node.getText() === name;
}

