import {tSpriteId} from "./misc/MiscTypes";

const SIZE_32BIT = 2;
const SIZE_16BIT = 4;

abstract class AddableExportableDirtyStructBase {

    protected _size: number = 0;
    protected _max!: number;
    protected vUint32!: Uint32Array
    protected vInt16!: Int16Array

    public get size(): number {
        return this._size;
    }

    protected realloc(newNoOfMaxObjects: number) {
        this._max = newNoOfMaxObjects;
        const oldView = this.vUint32;
        const buffer = new ArrayBuffer((this._max + 1) * 8);
        this.vUint32 = new Uint32Array(buffer)
        this.vInt16 = new Int16Array(buffer)
        if (oldView) this.vUint32.set(oldView);
    }

    public forEach(callback: (ref: number) => void) {
        const end = this._size;
        for ( let ref = 1; ref <= end; ref++) {
            if (this.vUint32[ref * SIZE_32BIT + 1] !== 0) {
                callback(ref as number);
            }
        }
    }

    public exists(ref: number): boolean {
        return this.vUint32[ref * SIZE_32BIT + 1] !== 0
    }

    public getX(ref: number): number {
        return this.vInt16[ref * SIZE_16BIT];
    }

    public getY(ref: number): number {
        return this.vInt16[ref * SIZE_16BIT + 1];
    }

    public getSpriteId(ref: number): tSpriteId {
        return this.vUint32[ref * SIZE_32BIT + 1] as tSpriteId;
    }
}

export interface AddableExportableDirtyStructExport {
    _exportOf_AddableExportableDirtyStruct: never;
    max: number;
    size: number;
    noOfDirty: number;
    syncFull: boolean;
    transfer: ArrayBuffer[]
}

export interface AddableExportableDirtyStructConfig {
    initialNumberOfObjects: number;
    fullSyncRatio?: number;
}

export class AddableExportableDirtyStruct extends AddableExportableDirtyStructBase {

    private config: AddableExportableDirtyStructConfig;
    private maxDirty: number = 0;

    constructor(config: AddableExportableDirtyStructConfig) {
        super();
        this.config = config;
        this.config.fullSyncRatio ??= undefined;
        this.realloc(this.config.initialNumberOfObjects);
    }

    protected override realloc(newNoOfMaxObjects: number) {
        super.realloc(newNoOfMaxObjects)
        const oldDirtyBuffer = this.dirtySetView;
        this.dirtySetView = new Uint32Array(Math.ceil(this._max / 32));
        this.maxDirty = Math.floor(this._max * this.config.fullSyncRatio!)
        this.dirtyIdsView = new Uint32Array(this.maxDirty);
        if (oldDirtyBuffer) this.dirtySetView.set(oldDirtyBuffer);
    }

    private readonly freeIds: number[] = [];

    public new(): number {
        if (this.freeIds.length > 0) {
            return this.freeIds.pop()!;
        } else {
            if (this._size === this._max) {
                this.realloc(this._max * 2);
            }
            return ++this._size as number;
        }
    }

    public free(ref: number): void {
        this.vUint32.fill(0, ref * SIZE_32BIT, (ref + 1) * SIZE_32BIT);
        this.freeIds.push(ref);
    }

    private dirtySetView!: Uint32Array;
    private dirtyIdsView!: Uint32Array;
    private noOfDirtyObjects = 0;
    private syncFullNext: boolean = true;

    public dirty(ref: number) {
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

    private exportMsg: AddableExportableDirtyStructExport = {max: 0, size: 0, syncFull: false, noOfDirty: 0, transfer: []} as unknown as AddableExportableDirtyStructExport;
    private exportViewsMaxNoOfObjects: number = 0;
    public exportDirtyIdsView!: Uint32Array;
    private expUint32!: Uint32Array;

    public export(): AddableExportableDirtyStructExport {
        if (this.exportViewsMaxNoOfObjects !== this._max) {
            this.exportViewsMaxNoOfObjects = this._max;
            this.exportDirtyIdsView = new Uint32Array(this.dirtyIdsView.length);
            this.exportMsg.transfer[0] = this.exportDirtyIdsView.buffer as ArrayBuffer;
            this.expUint32 = new Uint32Array(this.vUint32.length);
            this.exportMsg.transfer[1] = this.expUint32.buffer as ArrayBuffer;
        }

        const msg = this.exportMsg;
        msg.max = this._max;
        msg.size = this._size;
        if (this.syncFullNext) {
            msg.syncFull = true;
            msg.noOfDirty = this._max;
            this.expUint32.set(this.vUint32);
            this.syncFullNext = false;

        } else if (this.noOfDirtyObjects > 0) {
            msg.syncFull = false;
            msg.noOfDirty = this.noOfDirtyObjects;
            this.exportDirtyIdsView.set(this.dirtyIdsView);
            this.dirtySetView.fill(0);
            for (let i = 0; i < this.noOfDirtyObjects; ++i) {
                const ref = this.dirtyIdsView[i] as number;
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

    public setX(ref: number, value: number): this {
        this.vInt16[ref * SIZE_16BIT] = value;
        return this;
    }

    public addX(ref: number, value: number): this {
        this.vInt16[ref * SIZE_16BIT] += value;
        return this;
    }

    public setY(ref: number, value: number): this {
        this.vInt16[ref * SIZE_16BIT + 1] = value;
        return this;
    }

    public addY(ref: number, value: number): this {
        this.vInt16[ref * SIZE_16BIT + 1] += value;
        return this;
    }

    public setSpriteId(ref: number, value: tSpriteId): this {
        this.vUint32[ref * SIZE_32BIT + 1] = value;
        return this;
    }
}

export class AddableExportableDirtyStructReader extends AddableExportableDirtyStructBase {

    private importDirtyView!: Uint32Array;
    private impUint32!: Uint32Array;

    public import(data: AddableExportableDirtyStructExport, onChange?: (ref: number) => void, onFullSync?: () => void) {

        if (this._max !== data.max) {
            this.realloc(data.max);
        }
        this._size = data.size;

        if (this.importDirtyView?.buffer !== data.transfer[0]) {
            this.importDirtyView = new Uint32Array(data.transfer[0]);
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
                const ref = this.importDirtyView[i] as number;
                const pos = ref * SIZE_32BIT
                this.vUint32[pos] = this.impUint32[pos];
                this.vUint32[pos + 1] = this.impUint32[pos + 1];
            }
            if (onChange) {
                for (let i = 0; i < data.noOfDirty; ++i) {
                    onChange?.(this.importDirtyView[i] as number);
                }
            }
        }
    }
}
