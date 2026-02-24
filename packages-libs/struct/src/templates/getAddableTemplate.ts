import {CodeTemplate} from "../CodeFile";
import {StructMeta} from "../StructMeta";
import {getUseNewCodeMethods} from "./helpers";

export function getAddableTemplate(struct: StructMeta) {
    const ID = struct.idTsType || "number";
    return `${CodeTemplate.variable("imports")}
    
${CodeTemplate.variable("templates")}

${CodeTemplate.variable("sizeConstants")}

export interface ${struct.name}Config {
    initialNumberOfObjects: number;
}

export class ${struct.name} {

    private _size: number = 0;
    private _max: number;
    ${CodeTemplate.variable("viewProperties")}

    constructor( config: ${struct.name}Config ) {
        this.realloc(config.initialNumberOfObjects);
    }

    public get size(): number {
        return this._size;
    }

    protected realloc(newNoOfMaxObjects: number) {
        this._max = newNoOfMaxObjects;
        ${CodeTemplate.variable("alloc")}
    }

    public forEach(callback: (ref: ${ID}) => void) {
        ${CodeTemplate.variable("loop")}
    }
    
    public exists(ref: ${ID}): boolean {
        return ${CodeTemplate.variable("exists")}
    }
    
    ${getUseNewCodeMethods(struct)}
    
    ${CodeTemplate.variable("getters")}
            
    ${CodeTemplate.variable("setters")}
}
`
}