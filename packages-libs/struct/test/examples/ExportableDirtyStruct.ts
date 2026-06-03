

export type tRef = number & { tRef: never };

const SIZE_32BIT = 2;
const SIZE_16BIT = 4;

export interface ExportableDirtyStructExport {
    _exportOf_ExportableDirtyStruct: never;
    _max: number;
    noOfDirty: number;
    syncFull: boolean;
    transfer: ArrayBuffer[]
}

interface ExportableDirtyStructReaderConfig {
    initialNumberOfObjects: number;
}

export interface ExportableDirtyStructConfig extends ExportableDirtyStructReaderConfig {
    fullSyncRatio?: number;
}

abstract class ExportableDirtyStructBase {

    protected readonly _max: number;
    protected readonly vUint32!: Uint32Array
    protected readonly vInt16!: Int16Array

    protected constructor( newNoOfMaxObjects: number ) {
        this._max = newNoOfMaxObjects;
        const buffer = new ArrayBuffer(this._max * 8);
        this.vUint32 = new Uint32Array(buffer)
        this.vInt16 = new Int16Array(buffer)
    }

    public get size(): number {
        return this._max;
    }

    public forEach(callback: (obj: tRef) => void) {
        for (let i = 0; i < this._max; i++) {
            callback(i as tRef);
        }
    }

    public getX(ref: tRef): number {
        return this.vInt16[ref * SIZE_16BIT];
    }

    public getY(ref: tRef): number {
        return this.vInt16[ref * SIZE_16BIT + 1];
    }

    public getSpriteId(ref: tRef): number {
        return this.vUint32[ref * SIZE_32BIT + 1];
    }
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

export class ExportableDirtyStruct extends ExportableDirtyStructBase {

    private readonly config: ExportableDirtyStructConfig;

    private readonly dirtySetView: Uint32Array;
    private readonly dirtyIdsView: Uint8Array | Uint16Array | Uint32Array;
    private noOfDirtyObjects = 0;
    private readonly maxNoOfDirtyObjects: number;
    private syncFullNext: boolean = true;

    private exportMsg: ExportableDirtyStructExport = {_max: 0, syncFull: false, noOfDirty: 0, transfer: []} as unknown as ExportableDirtyStructExport;
    public exportDirtyIdsView: Uint8Array | Uint16Array | Uint32Array;

    private readonly expUint32!: Uint32Array;

    constructor(config: ExportableDirtyStructConfig) {
        super( config.initialNumberOfObjects );
        this.config = config;
        this.config.fullSyncRatio ??= undefined;

        const idsViewType = getIdArrayType(this._max);
        this.dirtySetView = new Uint32Array(Math.ceil(this._max / 32));
        this.maxNoOfDirtyObjects = Math.floor(this._max * this.config.fullSyncRatio!)
        this.dirtyIdsView = new idsViewType( this.maxNoOfDirtyObjects);

        this.exportMsg._max = this._max;
        this.exportDirtyIdsView = new idsViewType(this.maxNoOfDirtyObjects);
        this.exportMsg.transfer[0] = this.exportDirtyIdsView.buffer as ArrayBuffer;
        this.expUint32 = new Uint32Array(this.vUint32.length);
        this.exportMsg.transfer[1] = this.expUint32.buffer as ArrayBuffer;
    }

    public dirty(ref: tRef) {
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

    public export(): ExportableDirtyStructExport {
        const msg = this.exportMsg;
        if (this.syncFullNext) {
            msg.syncFull = true;
            msg.noOfDirty = this._max;
            this.expUint32.set(this.vUint32);
            this.syncFullNext = false;

        } else if (this.noOfDirtyObjects > 0) {
            msg.syncFull = false;
            msg.noOfDirty = this.noOfDirtyObjects;
            this.dirtySetView.fill(0);
            for (let i = 0; i < this.noOfDirtyObjects; ++i) {
                this.exportDirtyIdsView[i] = this.dirtyIdsView[i]
                const ref = this.dirtyIdsView[i] as tRef;
                const pos = ref * SIZE_32BIT
                this.expUint32[pos] = this.vUint32[pos];
                this.expUint32[pos + 1] = this.vUint32[pos + 1];
            }
            this.noOfDirtyObjects = 0;
        } else {
            msg.syncFull = false;
            msg.noOfDirty = 0;
        }
        return msg;
    }

    public setX(ref: tRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT] = value;
        return this;
    }

    public setY(ref: tRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT + 1] = value;
        return this;
    }

    public setSpriteId(ref: tRef, value: number): this {
        this.vUint32[ref * SIZE_32BIT + 1] = value;
        return this;
    }
}

export class ExportableDirtyStructReader extends ExportableDirtyStructBase {

    private importDirtyView!: Uint8Array | Uint16Array | Uint32Array;
    private impUint32!: Uint32Array;

    constructor(config: ExportableDirtyStructReaderConfig) {
        super(config.initialNumberOfObjects);
    }

    public import(data: ExportableDirtyStructExport, onChange?: (ref: tRef) => void, onFullSync?: () => void) {

        if (!this.importDirtyView) {
            this.importDirtyView = new (getIdArrayType(this._max))(data.transfer[0]);
            this.impUint32 = new Uint32Array(data.transfer[1]);
        }

        if (data.syncFull) {
            this.vUint32.set(this.impUint32);
            if (onFullSync) {
                onFullSync();
            } else if (onChange) {
                this.forEach(onChange);
            }
        } else {
            for (let i = 0; i < data.noOfDirty; ++i) {
                const ref = this.importDirtyView[i] as tRef;
                const pos = ref * SIZE_32BIT
                this.vUint32[pos] = this.impUint32[pos];
                this.vUint32[pos + 1] = this.impUint32[pos + 1];
            }
            if (onChange) {
                for (let i = 0; i < data.noOfDirty; ++i) {
                    onChange?.(this.importDirtyView[i] as tRef);
                }
            }
        }
    }
}
