import {CodeTemplate} from "../CodeFile";
import {StructMeta} from "../StructMeta";

export function getBasicTemplate(struct: StructMeta) {
    const ID = struct.idTsType || "number";
    return `${CodeTemplate.variable("imports")}
    
${CodeTemplate.variable("templates")}

${CodeTemplate.variable("sizeConstants")}

export interface ${struct.name}Config {
    initialNumberOfObjects: number;
}

export class ${struct.name} {

    private readonly _max: number;
    ${CodeTemplate.variable("viewProperties")}

    constructor( config: ${struct.name}Config ) {
        this._max = config.initialNumberOfObjects;
        ${CodeTemplate.variable("alloc")}
    }

    public get size(): number {
        return this._max;
    }

    public forEach(callback: (obj: ${ID}) => void) {
        for (let i = 0; i < this._max; i++) {
            callback(i as ${ID});
        }
    }
    
    ${CodeTemplate.variable("getters")}
            
    ${CodeTemplate.variable("setters")}
}
`
}