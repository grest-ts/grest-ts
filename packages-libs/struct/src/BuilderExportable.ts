import {PropertyMeta, StructMeta} from "./StructMeta";
import {CodeFile, CodeTemplate} from "./CodeFile";
import {getAddableExportableDirtyTemplate} from "./templates/getAddableExportableDirtyTemplate";
import {getAddableTemplate} from "./templates/getAddableTemplate";
import {getBasicTemplate} from "./templates/getBasicTemplate";
import {getAddableExportableTemplate} from "./templates/getAddableExportableTemplate";
import {getExportableDirtyTemplate} from "./templates/getExportableDirtyTemplate";
import {getExportableTemplate} from "./templates/getExportableTemplate";

interface ChunkInfo {
    sizeConstName: string
    viewName: string
    viewJsType: string
    importViewName: string;
    exportViewName: string;
    varSuffix: string;
    noOfElements: number
    noOfProperties: number;
    bits: number;
    seenPropertyBits: SeenBits[]
    usedPropertyDataTypes: SeenDataTypes[]
    properties: ChunkProperty[]
}

interface SeenBits {
    bits: 8 | 16 | 32 | 64,
    sizeConst: string;
}

interface SeenDataTypes {
    viewName: string;
    typeArray: string
    sizeConst: string;
    bits: 8 | 16 | 32 | 64,
}

interface ChunkProperty extends PropertyMeta {
    sizeConst: string;
    byteLoc: string;
    byteLocMulti: string;
    viewName: string;
    viewType: JSViewTypes,
    viewJsType: string;
}

type JSViewTypes = "int8" | "int16" | "int32" | "uint8" | "uint16" | "uint32" | "float32" | "float64";

export class BuilderExportable {

    private static setup(struct: StructMeta): ChunkInfo[] {
        const hasMultipleChunks = struct.chunks.length > 1;
        const chunkInfo: ChunkInfo[] = new Array(struct.chunks.length);
        struct.chunks.forEach((chunk, chunkIndex) => {
            const usedBits = new Map<8 | 16 | 32 | 64, SeenBits>([]);
            const usedDataTypes = new Map<string, SeenDataTypes>();
            const chunkProperties: ChunkProperty[] = []

            chunk.properties.forEach((property) => {
                const hasMultipleValues = chunk.properties.length > 1;
                let dataTypeBits: 8 | 16 | 32 | 64;
                let viewType2: JSViewTypes;
                if (property.type === "bit" || property.type === "bool") {
                    dataTypeBits = 8;
                    viewType2 = "uint8"
                } else {
                    dataTypeBits = property.bits as 8 | 16 | 32 | 64;
                    viewType2 = property.type
                }
                const sizeConst2 = hasMultipleValues ? (hasMultipleChunks ? "B" + chunkIndex + "_" : "") + "SIZE_" + dataTypeBits + "BIT" : "";
                const byteLoc = sizeConst2 ? sizeConst2 + (property.offset > 0 ? " + " + property.offset : "") : "";
                const prop: ChunkProperty = {
                    ...property,
                    sizeConst: sizeConst2,
                    byteLoc: byteLoc,
                    byteLocMulti: byteLoc ? " * " + byteLoc : "",
                    viewName: hasMultipleValues ? "v" + (hasMultipleChunks ? chunkIndex : "") + ucFirst(viewType2) : property.name,
                    viewType: viewType2,
                    viewJsType: ucFirst(viewType2) + "Array"
                }
                chunkProperties.push(prop)

                if (hasMultipleValues) {
                    usedBits.set(dataTypeBits, {
                        bits: dataTypeBits,
                        sizeConst: prop.sizeConst
                    });
                }
                usedDataTypes.set(viewType2, {
                    viewName: prop.viewName,
                    typeArray: prop.viewJsType,
                    sizeConst: prop.sizeConst,
                    bits: dataTypeBits
                });
            })

            let controlling: ChunkProperty | undefined = undefined;
            for (const prop of chunkProperties) {
                if (!controlling || prop.bits > controlling.bits) {
                    controlling = prop;
                }
            }
            if (!controlling) {
                throw new Error("Chunk has no properties for '" + struct.name + "'");
            }
            const varSuffix = hasMultipleChunks ? chunkIndex + "" : "";
            chunkInfo[chunkIndex] = {
                sizeConstName: controlling.sizeConst,
                viewName: controlling.viewName,
                exportViewName: "exp" + varSuffix + ucFirst(controlling.viewType),
                importViewName: "imp" + varSuffix + ucFirst(controlling.viewType),
                viewJsType: controlling.viewJsType,
                varSuffix: varSuffix,
                noOfElements: chunk.bits / controlling.bits,
                noOfProperties: chunk.properties.length,
                bits: chunk.bits,
                seenPropertyBits: Array.from(usedBits.values()).sort(((a, b) => b.bits - a.bits)),
                usedPropertyDataTypes: Array.from(usedDataTypes.values()).sort(((a, b) => b.bits - a.bits)),
                properties: chunkProperties
            };
        });

        return chunkInfo;
    }

    public static build(struct: StructMeta) {
        const ID = struct.idTsType || "number";
        const chunkInfo = this.setup(struct);

        let templateStr: string;

        if (struct.useNew) {
            if (struct.useExport) {
                if (struct.useDirty) {
                    templateStr = getAddableExportableDirtyTemplate(struct);
                } else {
                    templateStr = getAddableExportableTemplate(struct);
                }
            } else {
                if (struct.useDirty) {
                    throw new Error("Invalid configuration. 'useDirty' must be used with 'useExport'!")
                } else {
                    templateStr = getAddableTemplate(struct);
                }
            }
        } else {
            if (struct.useExport) {
                if (struct.useDirty) {
                    templateStr = getExportableDirtyTemplate(struct);
                } else {
                    templateStr = getExportableTemplate(struct);
                }
            } else {
                if (struct.useDirty) {
                    throw new Error("Invalid configuration. 'useDirty' must be used with 'useExport'!")
                } else {
                    templateStr = getBasicTemplate(struct);
                }
            }
        }

        const getExistsLines = () => {
            const checks: string[] = [];
            chunkInfo.forEach((chunk, i) => {
                chunk.properties.forEach((prop) => {
                    if (prop.mustExist) {
                        checks.push("this." + chunk.viewName + "[ref" + prop.byteLocMulti + "] !== 0")
                    }
                })
            })
            if (struct.useNew && checks.length === 0) {
                throw new Error("Must have at least one property marked as MUST_EXIST for '" + struct.name + "'")
            }
            return checks.join(" && ");
        }

        return new CodeFile().push(new CodeTemplate(templateStr)

            .lines("fullSyncRatio", lines => {
                lines.push("0.35");
            })

            .lines("imports", lines => {
                const importsMap = new Map<string, Set<string>>();
                struct.chunks.forEach((chunk) => {
                    chunk.properties.forEach((property) => {
                        if (property.tsType && property.tsTypeImport) {
                            let set = importsMap.get(property.tsTypeImport);
                            if (!set) {
                                set = new Set();
                                importsMap.set(property.tsTypeImport, set);
                            }
                            set.add(property.tsType)
                        }
                    })
                })
                importsMap.forEach((imports, source) => {
                    lines.push("import {" + Array.from(imports.values()).join(", ") + "} from \"" + source + "\";")
                })
            })

            .lines("templates", lines => {
                if (struct.idTsType && struct.idTsTypeDefinition) {
                    lines.push(struct.idTsTypeDefinition + "\n");
                }
                struct.chunks.forEach((chunk) => {
                    chunk.properties.forEach((prop) => {
                        if (prop.tsTypeDefinition) {
                            lines.push(prop.tsTypeDefinition + "\n")
                        }
                    })
                })
            })

            .lines("sizeConstants", lines => {
                chunkInfo.forEach((chunk, index) => {
                    chunk.seenPropertyBits.forEach((bits) => {
                        lines.push("const " + bits.sizeConst + " = " + (chunk.bits / bits.bits) + ";");
                    })
                })
            })

            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------

            .lines("viewProperties", (lines) => {
                chunkInfo.forEach((chunk, index) => {
                    chunk.usedPropertyDataTypes.forEach(type => {
                        lines.push("protected " + (struct.useNew ? "" : "readonly ") + type.viewName + "!: " + type.typeArray)
                    })
                })
            })

            .lines("alloc", (lines) => {
                chunkInfo.forEach((chunk, i) => {
                    const oldPropertyName = struct.useNew ? "oldView" + chunk.varSuffix : "";
                    oldPropertyName && lines.push("const " + oldPropertyName + " = this." + chunk.viewName + ";");

                    if (chunk.usedPropertyDataTypes.length === 1) {
                        chunk.usedPropertyDataTypes.forEach((type) => {
                            lines.push("this." + type.viewName + " = new " + type.typeArray + "(" +
                                "" + (struct.useNew ? "(this._max + 1)" : "this._max") +
                                (type.sizeConst ? " * " + type.sizeConst : "")
                                + ")")
                        })
                    } else {
                        const bufferName = "buffer" + chunk.varSuffix;
                        lines.push("const " + bufferName + " = new ArrayBuffer(" + (struct.useNew ? "(this._max + 1)" : "this._max") + " * " + (chunk.bits / 8) + ");");
                        chunk.usedPropertyDataTypes.forEach((type) => {
                            lines.push("this." + type.viewName + " = new " + type.typeArray + "(" + bufferName + ")")
                        })
                    }

                    oldPropertyName && lines.push("if (" + oldPropertyName + ") this." + chunk.viewName + ".set(" + oldPropertyName + ");");
                })
            })

            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------

            .lines("exists", (lines) => {
                const checks: string[] = [];
                chunkInfo.forEach((chunk, i) => {
                    chunk.properties.forEach((prop) => {
                        if (prop.mustExist) {
                            checks.push("this." + chunk.viewName + "[ref" + prop.byteLocMulti + "] !== 0")
                        }
                    })
                })
                if (struct.useNew && checks.length === 0) {
                    throw new Error("Must have at least one property marked as MUST_EXIST for '" + struct.name + "'")
                }
                lines.push(getExistsLines())
            })

            .lines("loop", (lines) => {
                lines.push(`const end = this._size;
for ( let ref = 1; ref <= end; ref++) {
    if (${getExistsLines()}) {
        callback(ref as ${ID});
    }
}`)
            })

            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------

            .lines("free", (lines => {
                chunkInfo.forEach((chunk) => {
                    if (chunk.noOfProperties === 1) {
                        lines.push("this." + chunk.viewName + "[ref] = 0;")
                    } else {
                        // for (let i = 0; i < chunk.noOfProperties; i++) {
                        //     lines.push("this." + chunk.viewName + "[ref * " + chunk.sizeConstName + (i > 0 ? " + " + i : "") + "] = 0;")
                        // }
                        lines.push("this." + chunk.viewName + ".fill(0, ref * " + chunk.sizeConstName + ", (ref + 1) * " + chunk.sizeConstName + ");")
                    }
                })
            }))

            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------

            .lines("exportViews", lines => {
                chunkInfo.forEach((chunk, i) => {
                    lines.push("private " + (struct.useNew ? "" : "readonly ") + chunk.exportViewName + "!: " + chunk.viewJsType + ";");
                });
            })

            .lines("exportViewsCreation", lines => {
                chunkInfo.forEach((chunk, i) => {
                    lines.push("this." + chunk.exportViewName + " = new " + chunk.viewJsType + "(this." + chunk.viewName + ".length);");
                    lines.push("this.exportMsg.transfer[" + (i + (struct.useDirty ? 1 : 0)) + "] = this." + chunk.exportViewName + ".buffer as ArrayBuffer;");
                })
            })

            .lines("exportViewsFullSync", lines => {
                chunkInfo.forEach((chunk, i) => {
                    lines.push("this." + chunk.exportViewName + ".set(this." + chunk.viewName + ");");
                })
            })

            .lines("exportViewsPartialSync", lines => {
                chunkInfo.forEach((chunk, i) => {
                    let posVar = "";
                    if (chunk.sizeConstName) {
                        posVar = "pos" + chunk.varSuffix;
                        lines.push("const " + posVar + " = ref * " + chunk.sizeConstName);
                    } else {
                        posVar = "ref";
                    }
                    for (let i = 0; i < chunk.noOfElements; i++) {
                        const add = i > 0 ? " + " + i : "";
                        lines.push("this." + chunk.exportViewName + "[" + posVar + add + "] = this." + chunk.viewName + "[" + posVar + add + "];");
                    }
                })
            })

            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------

            .lines("importViewDefinitions", lines => {
                chunkInfo.forEach((chunk) => {
                    lines.push("private " + chunk.importViewName + "!: " + chunk.viewJsType + ";");
                })
            })

            .lines("importViewInitializations", lines => {
                chunkInfo.forEach((chunk, i) => {
                    lines.push("this." + chunk.importViewName + " = new " + chunk.viewJsType + "(data.transfer[" + (i + (struct.useDirty ? 1 : 0)) + "]);");
                })
            })

            .lines("importFullSync", lines => {
                chunkInfo.forEach((chunk) => {
                    lines.push("this." + chunk.viewName + ".set(this." + chunk.importViewName + ");");
                })
            })

            .lines("importDirtySync", lines => {
                chunkInfo.forEach((chunk) => {
                    let posVarName = "";
                    if (chunk.sizeConstName) {
                        posVarName = "pos" + chunk.varSuffix;
                        lines.push("const " + posVarName + " = ref * " + chunk.sizeConstName);
                    } else {
                        posVarName = "ref";
                    }
                    for (let i = 0; i < chunk.noOfElements; i++) {
                        const add = i > 0 ? " + " + i : "";
                        lines.push("this." + chunk.viewName + "[" + posVarName + add + "] = this." + chunk.importViewName + "[" + posVarName + add + "];");
                    }
                })
            })

            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------
            // ------------------------------------------------------------------------------------------------------------------------

            .lines("getters", (lines) => {
                chunkInfo.forEach((chunk, i) => {
                    chunk.properties.forEach((prop) => {

                        if (prop.type === "bool" || prop.type === "bit") {
                            const resType = prop.type === "bool" ? "boolean" : "0 | 1";
                            const mask = prop.mask ?? 0;
                            lines.push(`
public get${ucFirst(prop.name)}(ref: ${ID}): ${resType} {
    return (this.${prop.viewName}[ref${prop.byteLocMulti}] & ${mask})${mask > 1 ? " >> " + Math.log2(mask) : ""}${prop.type === "bool" ? " !== 0" : " as " + resType};
}`)

                        } else {
                            lines.push(`
public get${ucFirst(prop.name)}(ref: ${ID}): ${prop.tsType ?? "number"} {
    return this.${prop.viewName}[ref${prop.byteLocMulti}]${prop.tsType ? " as " + prop.tsType : ""};
}`)
                        }

                    })
                })
            })

            .lines("setters", lines => {
                chunkInfo.forEach((chunk, i) => {
                    chunk.properties.forEach((prop) => {

                        if (prop.type === "bool" || prop.type === "bit") {
                            const resType = prop.type === "bool" ? "boolean" : "0 | 1";
                            const mask = prop.mask ?? 0;

                            lines.push(`
public set${ucFirst(prop.name)}(ref: ${ID}, value: ${resType}): this {
    const pos = ref${prop.byteLocMulti};
    this.${prop.viewName}[pos] = (this.${prop.viewName}[pos] & ${~mask}) | ${mask > 1 ? "((+value & 1) << " + Math.log2(mask) + ")" : "(+value & 1)"};
    return this;
}`)

                        } else {

                            lines.push(`
public set${ucFirst(prop.name)}(ref: ${ID}, value: ${prop.tsType ?? "number"}): this {
    this.${prop.viewName}[ref${prop.byteLocMulti}] = value;
    return this;
}`)

                            if (prop.addMath) {
                                lines.push(`
public add${ucFirst(prop.name)}(ref: ${ID}, value: ${prop.tsType ?? "number"}): this {
    this.${prop.viewName}[ref${prop.byteLocMulti}] += value;
    return this;
}`)
                            }
                        }

                    })
                })
            })
        ).build();

    }

}

function ucFirst(val: string): string {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}