import {CodeTemplate} from "../CodeFile";
import {StructMeta} from "../StructMeta";
import {getUseNewCodeMethods} from "./helpers";

export function getAddableExportableTemplate(struct: StructMeta) {
    const ID = struct.idTsType || "number";
    return `${CodeTemplate.variable("imports")}
    
${CodeTemplate.variable("templates")}

${CodeTemplate.variable("sizeConstants")}

abstract class ${struct.name}Base {
        
    protected _size: number = 0;
    protected _max: number;
    ${CodeTemplate.variable("viewProperties")}

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
    
    ${CodeTemplate.variable("getters")}
}

export interface ${struct.name}Export {
    _exportOf_${struct.name}: never;
    max: number;
    size: number;
    transfer: ArrayBuffer[]
}

export interface ${struct.name}Config {
    initialNumberOfObjects: number;
}

export class ${struct.name} extends ${struct.name}Base {

    private config: ${struct.name}Config;

    constructor(config: ${struct.name}Config) {
        super();
        this.config = config;
        this.realloc(this.config.initialNumberOfObjects);
    }

    ${getUseNewCodeMethods(struct)}

    private exportMsg: ${struct.name}Export = {max: 0, size: 0, transfer: []} as ${struct.name}Export;
    private exportViewsMaxNoOfObjects: number;
    ${CodeTemplate.variable("exportViews")}

    public export(): ${struct.name}Export {
         if (this.exportViewsMaxNoOfObjects !== this._max) {
            this.exportViewsMaxNoOfObjects = this._max;
            ${CodeTemplate.variable("exportViewsCreation")}
        }

        const msg = this.exportMsg;
        msg.max = this._max;
        msg.size = this._size;
        ${CodeTemplate.variable("exportViewsFullSync")}
        
        return msg;
    }
       
    ${CodeTemplate.variable("setters")}
}

export class ${struct.name}Reader extends ${struct.name}Base {

    ${CodeTemplate.variable("importViewDefinitions")}
    
    public import(data: ${struct.name}Export, onChange?: (ref: ${ID}) => void, onFullSync?: () => void) {
    
        if (this._max !== data.max) {
            this.realloc(data.max);
            ${CodeTemplate.variable("importViewInitializations")}
        }
        this._size = data.size;

        ${CodeTemplate.variable("importFullSync")}
        if (onFullSync) {
            onFullSync();
        } else if (onChange) {
            this.forEach(onChange);
        }
    }
}
`
}