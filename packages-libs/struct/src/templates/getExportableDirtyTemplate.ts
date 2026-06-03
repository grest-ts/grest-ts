import {CodeTemplate} from "../CodeFile";
import {StructMeta} from "../StructMeta";

export function getExportableDirtyTemplate(struct: StructMeta) {
    const ID = struct.idTsType || "number";
    return `${CodeTemplate.variable("imports")}
    
${CodeTemplate.variable("templates")}

${CodeTemplate.variable("sizeConstants")}

export interface ${struct.name}Export {
    _exportOf_${struct.name}: never;
    _max: number;
    noOfDirty: number;
    syncFull: boolean;
    transfer: ArrayBuffer[]
}

interface ${struct.name}ReaderConfig {
    initialNumberOfObjects: number;
}

export interface ${struct.name}Config extends ${struct.name}ReaderConfig {
    fullSyncRatio?: number;
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

function getIdArrayType( noOfObjects: number ): typeof Uint8Array | typeof Uint16Array | typeof Uint32Array {
    if( noOfObjects <= 255 ) {
        return Uint8Array
    } else if( noOfObjects <= 65535 ) {
        return Uint16Array
    } else if( noOfObjects <= 4294967295 ) {
        return Uint32Array
    } else {
        throw new Error("Overflow! Can't store more than uint32.MAX_VALUE of objects");
    }
}

export class ${struct.name} extends ${struct.name}Base {

    private readonly config: ${struct.name}Config;
    
    private readonly dirtySetView: Uint32Array;
    private readonly dirtyIdsView: Uint8Array | Uint16Array | Uint32Array;
    private noOfDirtyObjects = 0;
    private readonly maxNoOfDirtyObjects: number;
    private syncFullNext: boolean = true;
    
    private exportMsg: ${struct.name}Export = {_max: 0, syncFull: false, noOfDirty: 0, transfer: []} as unknown as ${struct.name}Export;
    public exportDirtyIdsView: Uint8Array | Uint16Array | Uint32Array;
    
    ${CodeTemplate.variable("exportViews")}
    
    constructor(config: ${struct.name}Config) {
        super( config.initialNumberOfObjects );
        this.config = config;
        this.config.fullSyncRatio ??= ${CodeTemplate.variable("fullSyncRation")};
        
        const idsViewType = getIdArrayType(this._max);
        this.dirtySetView = new Uint32Array(Math.ceil(this._max / 32));
        this.maxNoOfDirtyObjects = Math.floor(this._max * this.config.fullSyncRatio!)
        this.dirtyIdsView = new idsViewType( this.maxNoOfDirtyObjects);

        this.exportMsg._max = this._max;
        this.exportDirtyIdsView = new idsViewType(this.maxNoOfDirtyObjects);
        this.exportMsg.transfer[0] = this.exportDirtyIdsView.buffer as ArrayBuffer;
        ${CodeTemplate.variable("exportViewsCreation")}
    }

    public dirty(ref: ${ID}) {
        if (this.syncFullNext === false) {
            const byteIndex = ref >>> 5;
            const bit = 1 << (ref & 31);
            if ((this.dirtySetView[byteIndex] & bit) === 0) {
                if (this.noOfDirtyObjects >= this.maxNoOfDirtyObjects) {
                    this.syncFullNext = true;
                } else {
                    this.dirtySetView[byteIndex] |= bit;
                    this.dirtyIdsView[this.noOfDirtyObjects] = ref;
                    this.noOfDirtyObjects++;
                }
            }
        }
    }

    public export(): ${struct.name}Export {
        const msg = this.exportMsg;
        if (this.syncFullNext) {
            msg.syncFull = true;
            msg.noOfDirty = this._max;
            ${CodeTemplate.variable("exportViewsFullSync")}
            this.syncFullNext = false;

        } else if (this.noOfDirtyObjects > 0) {
            msg.syncFull = false;
            msg.noOfDirty = this.noOfDirtyObjects;
            this.dirtySetView.fill(0);
            for (let i = 0; i < this.noOfDirtyObjects; ++i) {
                this.exportDirtyIdsView[i] = this.dirtyIdsView[i]
                const ref = this.dirtyIdsView[i] as ${ID};
                ${CodeTemplate.variable("exportViewsPartialSync")}
            }
            this.noOfDirtyObjects = 0;
        } else {
            msg.syncFull = false;
            msg.noOfDirty = 0;
        }
        return msg;
    }
       
    ${CodeTemplate.variable("setters")}
}

export class ${struct.name}Reader extends ${struct.name}Base {

    private importDirtyView!: Uint8Array | Uint16Array | Uint32Array;
    ${CodeTemplate.variable("importViewDefinitions")}
         
    constructor(config: ${struct.name}ReaderConfig) {
        super(config.initialNumberOfObjects);
    }
    
    public import(data: ${struct.name}Export, onChange?: (ref: ${ID}) => void, onFullSync?: () => void) {

        if (!this.importDirtyView) {
            this.importDirtyView = new (getIdArrayType(this._max))(data.transfer[0]);
            ${CodeTemplate.variable("importViewInitializations")}
        }

        if (data.syncFull) {
            ${CodeTemplate.variable("importFullSync")}
            if (onFullSync) {
                onFullSync();
            } else if (onChange) {
                this.forEach(onChange);
            }
        } else {
            for (let i = 0; i < data.noOfDirty; ++i) {
                const ref = this.importDirtyView[i] as ${ID};
                ${CodeTemplate.variable("importDirtySync")}
            }
            if (onChange) {
                for (let i = 0; i < data.noOfDirty; ++i) {
                    onChange?.(this.importDirtyView[i] as ${ID});
                }
            }
        }
    }
}
`
}