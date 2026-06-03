import {tSpriteId} from "./misc/MiscTypes";

export type tRef33 = number & { tRef33: never };

abstract class SingleAddableExportableDirtyStructBase {

    protected _size: number = 0;
    protected _max!: number;
    protected x!: Int16Array
    protected y!: Int16Array
    protected spriteId!: Uint32Array

    public get size(): number {
        return this._size;
    }

    protected realloc(newNoOfMaxObjects: number) {
        this._max = newNoOfMaxObjects;
        const oldView0 = this.x;
        this.x = new Int16Array((this._max + 1))
        if (oldView0) this.x.set(oldView0);
        const oldView1 = this.y;
        this.y = new Int16Array((this._max + 1))
        if (oldView1) this.y.set(oldView1);
        const oldView2 = this.spriteId;
        this.spriteId = new Uint32Array((this._max + 1))
        if (oldView2) this.spriteId.set(oldView2);
    }

    public forEach(callback: (ref: tRef33) => void) {
        const end = this._size;
        for ( let ref = 1; ref <= end; ref++) {
            if (this.spriteId[ref] !== 0) {
                callback(ref as tRef33);
            }
        }
    }

    public exists(ref: tRef33): boolean {
        return this.spriteId[ref] !== 0
    }

    public getX(ref: tRef33): number {
        return this.x[ref];
    }

    public getY(ref: tRef33): number {
        return this.y[ref];
    }

    public getSpriteId(ref: tRef33): tSpriteId {
        return this.spriteId[ref] as tSpriteId;
    }
}

export interface SingleAddableExportableDirtyStructExport {
    _exportOf_SingleAddableExportableDirtyStruct: never;
    max: number;
    size: number;
    noOfDirty: number;
    syncFull: boolean;
    transfer: ArrayBuffer[]
}

export interface SingleAddableExportableDirtyStructConfig {
    initialNumberOfObjects: number;
    fullSyncRatio?: number;
}

export class SingleAddableExportableDirtyStruct extends SingleAddableExportableDirtyStructBase {

    private config: SingleAddableExportableDirtyStructConfig;
    private maxDirty: number = 0;

    constructor(config: SingleAddableExportableDirtyStructConfig) {
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

    private readonly freeIds: tRef33[] = [];

    public new(): tRef33 {
        if (this.freeIds.length > 0) {
            return this.freeIds.pop()!;
        } else {
            if (this._size === this._max) {
                this.realloc(this._max * 2);
            }
            return ++this._size as tRef33;
        }
    }

    public free(ref: tRef33): void {
        this.x[ref] = 0;
        this.y[ref] = 0;
        this.spriteId[ref] = 0;
        this.freeIds.push(ref);
    }

    private dirtySetView!: Uint32Array;
    private dirtyIdsView!: Uint32Array;
    private noOfDirtyObjects = 0;
    private syncFullNext: boolean = true;

    public dirty(ref: tRef33) {
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

    private exportMsg: SingleAddableExportableDirtyStructExport = {max: 0, size: 0, syncFull: false, noOfDirty: 0, transfer: []} as unknown as SingleAddableExportableDirtyStructExport;
    private exportViewsMaxNoOfObjects: number = 0;
    public exportDirtyIdsView!: Uint32Array;
    private exp0Int16!: Int16Array;
    private exp1Int16!: Int16Array;
    private exp2Uint32!: Uint32Array;

    public export(): SingleAddableExportableDirtyStructExport {
        if (this.exportViewsMaxNoOfObjects !== this._max) {
            this.exportViewsMaxNoOfObjects = this._max;
            this.exportDirtyIdsView = new Uint32Array(this.dirtyIdsView.length);
            this.exportMsg.transfer[0] = this.exportDirtyIdsView.buffer as ArrayBuffer;
            this.exp0Int16 = new Int16Array(this.x.length);
            this.exportMsg.transfer[1] = this.exp0Int16.buffer as ArrayBuffer;
            this.exp1Int16 = new Int16Array(this.y.length);
            this.exportMsg.transfer[2] = this.exp1Int16.buffer as ArrayBuffer;
            this.exp2Uint32 = new Uint32Array(this.spriteId.length);
            this.exportMsg.transfer[3] = this.exp2Uint32.buffer as ArrayBuffer;
        }

        const msg = this.exportMsg;
        msg.max = this._max;
        msg.size = this._size;
        if (this.syncFullNext) {
            msg.syncFull = true;
            msg.noOfDirty = this._max;
            this.exp0Int16.set(this.x);
            this.exp1Int16.set(this.y);
            this.exp2Uint32.set(this.spriteId);
            this.syncFullNext = false;

        } else if (this.noOfDirtyObjects > 0) {
            msg.syncFull = false;
            msg.noOfDirty = this.noOfDirtyObjects;
            this.exportDirtyIdsView.set(this.dirtyIdsView);
            this.dirtySetView.fill(0);
            for (let i = 0; i < this.noOfDirtyObjects; ++i) {
                const ref = this.dirtyIdsView[i] as tRef33;
                this.exp0Int16[ref] = this.x[ref];
                this.exp1Int16[ref] = this.y[ref];
                this.exp2Uint32[ref] = this.spriteId[ref];
            }
            this.noOfDirtyObjects = 0;
        } else {
            msg.syncFull = false;
            msg.noOfDirty = 0;
        }
        return msg;
    }

    public setX(ref: tRef33, value: number): this {
        this.x[ref] = value;
        return this;
    }

    public addX(ref: tRef33, value: number): this {
        this.x[ref] += value;
        return this;
    }

    public setY(ref: tRef33, value: number): this {
        this.y[ref] = value;
        return this;
    }

    public addY(ref: tRef33, value: number): this {
        this.y[ref] += value;
        return this;
    }

    public setSpriteId(ref: tRef33, value: tSpriteId): this {
        this.spriteId[ref] = value;
        return this;
    }
}

export class SingleAddableExportableDirtyStructReader extends SingleAddableExportableDirtyStructBase {

    private importDirtyView!: Uint32Array;
    private imp0Int16!: Int16Array;
    private imp1Int16!: Int16Array;
    private imp2Uint32!: Uint32Array;

    public import(data: SingleAddableExportableDirtyStructExport, onChange?: (ref: tRef33) => void, onFullSync?: () => void) {

        if (this._max !== data.max) {
            this.realloc(data.max);
        }
        this._size = data.size;

        if (this.importDirtyView?.buffer !== data.transfer[0]) {
            this.importDirtyView = new Uint32Array(data.transfer[0]);
            this.imp0Int16 = new Int16Array(data.transfer[1]);
            this.imp1Int16 = new Int16Array(data.transfer[2]);
            this.imp2Uint32 = new Uint32Array(data.transfer[3]);
        }

        if (data.syncFull) {
            this.x.set(this.imp0Int16);
            this.y.set(this.imp1Int16);
            this.spriteId.set(this.imp2Uint32);
            if (onFullSync) {
                onFullSync();
            } else if (onChange) {
                this.forEach(onChange);
            }
        } else {
            for (let i = 0; i < data.noOfDirty; ++i) {
                const ref = this.importDirtyView[i] as tRef33;
                this.x[ref] = this.imp0Int16[ref];
                this.y[ref] = this.imp1Int16[ref];
                this.spriteId[ref] = this.imp2Uint32[ref];
            }
            if (onChange) {
                for (let i = 0; i < data.noOfDirty; ++i) {
                    onChange?.(this.importDirtyView[i] as tRef33);
                }
            }
        }
    }
}
