import {CodeTemplate} from "../CodeFile";
import {StructMeta} from "../StructMeta";
import {getUseNewCodeMethods} from "./helpers";

export function getAddableExportableDirtyTemplate(struct: StructMeta) {
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
    noOfDirty: number;
    syncFull: boolean;
    transfer: ArrayBuffer[]
}

export interface ${struct.name}Config {
    initialNumberOfObjects: number;
    fullSyncRatio?: number;
}

export class ${struct.name} extends ${struct.name}Base {

    private config: ${struct.name}Config;
    private maxDirty: number = 0;

    constructor(config: ${struct.name}Config) {
        super();
        this.config = config;
        this.config.fullSyncRatio ??= ${CodeTemplate.variable("fullSyncRation")};
        this.realloc(this.config.initialNumberOfObjects);
    }

    protected override realloc(newNoOfMaxObjects: number) {
        super.realloc(newNoOfMaxObjects)
        const oldDirtyBuffer = this.dirtySetView;
        this.dirtySetView = new Uint32Array(Math.ceil(this._max / 32));
        this.maxDirty = Math.floor(this._max * this.config.fullSyncRatio)
        this.dirtyIdsView = new Uint32Array(this.maxDirty);
        if (oldDirtyBuffer) this.dirtySetView.set(oldDirtyBuffer);
    }

    ${getUseNewCodeMethods(struct)}

    private dirtySetView: Uint32Array;
    private dirtyIdsView: Uint32Array;
    private noOfDirtyObjects = 0;
    private syncFullNext: boolean = true;

    public dirty(ref: ${ID}) {
        if (this.syncFullNext === false) {
            const byteIndex = ref >>> 5;
            const bit = 1 << (ref & 31);
            if ((this.dirtySetView[byteIndex] & bit) === 0) {
                if (this.noOfDirtyObjects >= this.maxDirty) {
                    this.syncFullNext = true;
                } else {
                    this.dirtySetView[byteIndex] |= bit;
                    this.dirtyIdsView[this.noOfDirtyObjects] = ref;
                    this.noOfDirtyObjects++;
                }
            }
        }
    }

    private exportMsg: ${struct.name}Export = {max: 0, size: 0, syncFull: false, noOfDirty: 0, transfer: []} as ${struct.name}Export;
    private exportViewsMaxNoOfObjects: number = 0;
    public exportDirtyIdsView: Uint32Array;
    ${CodeTemplate.variable("exportViews")}

    public export(): ${struct.name}Export {
        if (this.exportViewsMaxNoOfObjects !== this._max) {
            this.exportViewsMaxNoOfObjects = this._max;
            this.exportDirtyIdsView = new Uint32Array(this.dirtyIdsView.length);
            this.exportMsg.transfer[0] = this.exportDirtyIdsView.buffer as ArrayBuffer;
            ${CodeTemplate.variable("exportViewsCreation")}
        }

        const msg = this.exportMsg;
        msg.max = this._max;
        msg.size = this._size;
        if (this.syncFullNext) {
            msg.syncFull = true;
            msg.noOfDirty = this._max;
            ${CodeTemplate.variable("exportViewsFullSync")}
            this.syncFullNext = false;

        } else if (this.noOfDirtyObjects > 0) {
            msg.syncFull = false;
            msg.noOfDirty = this.noOfDirtyObjects;
            this.exportDirtyIdsView.set(this.dirtyIdsView);
            this.dirtySetView.fill(0);
            for (let i = 0; i < this.noOfDirtyObjects; ++i) {
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

    private importDirtyView: Uint32Array;
    ${CodeTemplate.variable("importViewDefinitions")}
    
    public import(data: ${struct.name}Export, onChange?: (ref: ${ID}) => void, onFullSync?: () => void) {
    
        if (this._max !== data.max) {
            this.realloc(data.max);
        }
        this._size = data.size;

        if (this.importDirtyView?.buffer !== data.transfer[0]) {
            this.importDirtyView = new Uint32Array(data.transfer[0]);
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