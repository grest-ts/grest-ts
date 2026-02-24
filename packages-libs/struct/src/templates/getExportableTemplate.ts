import {CodeTemplate} from "../CodeFile";
import {StructMeta} from "../StructMeta";

export function getExportableTemplate(struct: StructMeta) {
    const ID = struct.idTsType || "number";
    return `${CodeTemplate.variable("imports")}
    
${CodeTemplate.variable("templates")}

${CodeTemplate.variable("sizeConstants")}

export interface ${struct.name}Export {
    _exportOf_${struct.name}: never;
    transfer: ArrayBuffer[]
}

export interface ${struct.name}Config {
    initialNumberOfObjects: number;
}

abstract class ${struct.name}Base {
        
    protected readonly _max: number;
    ${CodeTemplate.variable("viewProperties")}

    protected constructor( newNoOfMaxObjects: number ) {
        this._max = newNoOfMaxObjects;
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
}

export class ${struct.name} extends ${struct.name}Base {

    private readonly exportMsg: ${struct.name}Export = {transfer: []} as ${struct.name}Export;
    ${CodeTemplate.variable("exportViews")}
    
    constructor(config: ${struct.name}Config) {
        super(config.initialNumberOfObjects);
        ${CodeTemplate.variable("exportViewsCreation")}
    }

    public export(): ${struct.name}Export {
        const msg = this.exportMsg;
        ${CodeTemplate.variable("exportViewsFullSync")}
        return msg;
    }
       
    ${CodeTemplate.variable("setters")}
}

export class ${struct.name}Reader extends ${struct.name}Base {

    private initialized: boolean = false;
    ${CodeTemplate.variable("importViewDefinitions")}
   
    constructor(config: ${struct.name}Config) {
        super(config.initialNumberOfObjects);
    }
    
    public import(data: ${struct.name}Export, onFullSync?: () => void) {
        if (!this.initialized) {
            this.initialized = true;
            ${CodeTemplate.variable("importViewInitializations")}
        }
        ${CodeTemplate.variable("importFullSync")}
        onFullSync?.();
    }
}
`
}