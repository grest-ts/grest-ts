import {tSpriteId} from "./misc/MiscTypes";

export type tRef33 = number & { tRef33: never };

export enum MyEnum {
    A = 10,
    B = 20
}

const B0_SIZE_16BIT = 4;
const B1_SIZE_32BIT = 3;
const B1_SIZE_16BIT = 6;
const B1_SIZE_8BIT = 12;

abstract class ComplexStructBase {

    protected _size: number = 0;
    protected _max: number;
    protected v0Int16: Int16Array
    protected v0Uint16: Uint16Array
    protected v1Uint32: Uint32Array
    protected v1Uint16: Uint16Array
    protected v1Uint8: Uint8Array
    protected v1Int8: Int8Array

    public get size(): number {
        return this._size;
    }

    protected realloc(newNoOfMaxObjects: number) {
        this._max = newNoOfMaxObjects;
        const oldView0 = this.v0Int16;
        const buffer0 = new ArrayBuffer((this._max + 1) * 8);
        this.v0Int16 = new Int16Array(buffer0)
        this.v0Uint16 = new Uint16Array(buffer0)
        if (oldView0) this.v0Int16.set(oldView0);
        const oldView1 = this.v1Uint32;
        const buffer1 = new ArrayBuffer((this._max + 1) * 12);
        this.v1Uint32 = new Uint32Array(buffer1)
        this.v1Uint16 = new Uint16Array(buffer1)
        this.v1Uint8 = new Uint8Array(buffer1)
        this.v1Int8 = new Int8Array(buffer1)
        if (oldView1) this.v1Uint32.set(oldView1);
    }

    public forEach(callback: (ref: tRef33) => void) {
        const end = this._size;
        for ( let ref = 1; ref <= end; ref++) {
            if (this.v1Uint32[ref * B1_SIZE_16BIT + 2] !== 0) {
                callback(ref as tRef33);
            }
        }
    }

    public exists(ref: tRef33): boolean {
        return this.v1Uint32[ref * B1_SIZE_16BIT + 2] !== 0
    }

    public getX(ref: tRef33): number {
        return this.v0Int16[ref * B0_SIZE_16BIT];
    }

    public getY(ref: tRef33): number {
        return this.v0Int16[ref * B0_SIZE_16BIT + 1];
    }

    public getWidth(ref: tRef33): number {
        return this.v0Uint16[ref * B0_SIZE_16BIT + 2];
    }

    public getHeight(ref: tRef33): number {
        return this.v0Uint16[ref * B0_SIZE_16BIT + 3];
    }

    public getClickId(ref: tRef33): number {
        return this.v1Uint32[ref * B1_SIZE_32BIT];
    }

    public getSpriteId(ref: tRef33): tSpriteId {
        return this.v1Uint16[ref * B1_SIZE_16BIT + 2] as tSpriteId;
    }

    public getTileX(ref: tRef33): number {
        return this.v1Uint8[ref * B1_SIZE_8BIT + 6];
    }

    public getTileY(ref: tRef33): number {
        return this.v1Uint8[ref * B1_SIZE_8BIT + 7];
    }

    public getOpacity(ref: tRef33): number {
        return this.v1Uint8[ref * B1_SIZE_8BIT + 8];
    }

    public getIsHighlighted(ref: tRef33): boolean {
        return (this.v1Uint8[ref * B1_SIZE_8BIT + 9] & 1) !== 0;
    }

    public getIsAnimated(ref: tRef33): 0 | 1 {
        return (this.v1Uint8[ref * B1_SIZE_8BIT + 9] & 2) >> 1 as 0 | 1;
    }

    public getSomething(ref: tRef33): MyEnum {
        return this.v1Int8[ref * B1_SIZE_8BIT + 10] as MyEnum;
    }
}

export interface ComplexStructExport {
    _exportOf_ComplexStruct: never;
    max: number;
    size: number;
    noOfDirty: number;
    syncFull: boolean;
    transfer: ArrayBuffer[]
}

export interface ComplexStructConfig {
    initialNumberOfObjects: number;
    fullSyncRatio?: number;
}

export class ComplexStruct extends ComplexStructBase {

    private config: ComplexStructConfig;
    private maxDirty: number = 0;

    constructor(config: ComplexStructConfig) {
        super();
        this.config = config;
        this.config.fullSyncRatio ??= undefined;
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

    private readonly freeIds: tRef33[] = [];

    public new(): tRef33 {
        if (this.freeIds.length > 0) {
            return this.freeIds.pop();
        } else {
            if (this._size === this._max) {
                this.realloc(this._max * 2);
            }
            return ++this._size as tRef33;
        }
    }

    public free(ref: tRef33): void {
        this.v0Int16.fill(0, ref * B0_SIZE_16BIT, (ref + 1) * B0_SIZE_16BIT);
        this.v1Uint32.fill(0, ref * B1_SIZE_32BIT, (ref + 1) * B1_SIZE_32BIT);
        this.freeIds.push(ref);
    }

    private dirtySetView: Uint32Array;
    private dirtyIdsView: Uint32Array;
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

    private exportMsg: ComplexStructExport = {max: 0, size: 0, syncFull: false, noOfDirty: 0, transfer: []} as ComplexStructExport;
    private exportViewsMaxNoOfObjects: number = 0;
    public exportDirtyIdsView: Uint32Array;
    private exp0Int16: Int16Array;
    private exp1Uint32: Uint32Array;

    public export(): ComplexStructExport {
        if (this.exportViewsMaxNoOfObjects !== this._max) {
            this.exportViewsMaxNoOfObjects = this._max;
            this.exportDirtyIdsView = new Uint32Array(this.dirtyIdsView.length);
            this.exportMsg.transfer[0] = this.exportDirtyIdsView.buffer as ArrayBuffer;
            this.exp0Int16 = new Int16Array(this.v0Int16.length);
            this.exportMsg.transfer[1] = this.exp0Int16.buffer as ArrayBuffer;
            this.exp1Uint32 = new Uint32Array(this.v1Uint32.length);
            this.exportMsg.transfer[2] = this.exp1Uint32.buffer as ArrayBuffer;
        }

        const msg = this.exportMsg;
        msg.max = this._max;
        msg.size = this._size;
        if (this.syncFullNext) {
            msg.syncFull = true;
            msg.noOfDirty = this._max;
            this.exp0Int16.set(this.v0Int16);
            this.exp1Uint32.set(this.v1Uint32);
            this.syncFullNext = false;

        } else if (this.noOfDirtyObjects > 0) {
            msg.syncFull = false;
            msg.noOfDirty = this.noOfDirtyObjects;
            this.exportDirtyIdsView.set(this.dirtyIdsView);
            this.dirtySetView.fill(0);
            for (let i = 0; i < this.noOfDirtyObjects; ++i) {
                const ref = this.dirtyIdsView[i] as tRef33;
                const pos0 = ref * B0_SIZE_16BIT
                this.exp0Int16[pos0] = this.v0Int16[pos0];
                this.exp0Int16[pos0 + 1] = this.v0Int16[pos0 + 1];
                this.exp0Int16[pos0 + 2] = this.v0Int16[pos0 + 2];
                this.exp0Int16[pos0 + 3] = this.v0Int16[pos0 + 3];
                const pos1 = ref * B1_SIZE_32BIT
                this.exp1Uint32[pos1] = this.v1Uint32[pos1];
                this.exp1Uint32[pos1 + 1] = this.v1Uint32[pos1 + 1];
                this.exp1Uint32[pos1 + 2] = this.v1Uint32[pos1 + 2];
            }
            this.noOfDirtyObjects = 0;
        } else {
            msg.syncFull = false;
            msg.noOfDirty = 0;
        }
        return msg;
    }

    public setX(ref: tRef33, value: number): this {
        this.v0Int16[ref * B0_SIZE_16BIT] = value;
        return this;
    }

    public addX(ref: tRef33, value: number): this {
        this.v0Int16[ref * B0_SIZE_16BIT] += value;
        return this;
    }

    public setY(ref: tRef33, value: number): this {
        this.v0Int16[ref * B0_SIZE_16BIT + 1] = value;
        return this;
    }

    public addY(ref: tRef33, value: number): this {
        this.v0Int16[ref * B0_SIZE_16BIT + 1] += value;
        return this;
    }

    public setWidth(ref: tRef33, value: number): this {
        this.v0Uint16[ref * B0_SIZE_16BIT + 2] = value;
        return this;
    }

    public setHeight(ref: tRef33, value: number): this {
        this.v0Uint16[ref * B0_SIZE_16BIT + 3] = value;
        return this;
    }

    public setClickId(ref: tRef33, value: number): this {
        this.v1Uint32[ref * B1_SIZE_32BIT] = value;
        return this;
    }

    public setSpriteId(ref: tRef33, value: tSpriteId): this {
        this.v1Uint16[ref * B1_SIZE_16BIT + 2] = value;
        return this;
    }

    public setTileX(ref: tRef33, value: number): this {
        this.v1Uint8[ref * B1_SIZE_8BIT + 6] = value;
        return this;
    }

    public setTileY(ref: tRef33, value: number): this {
        this.v1Uint8[ref * B1_SIZE_8BIT + 7] = value;
        return this;
    }

    public setOpacity(ref: tRef33, value: number): this {
        this.v1Uint8[ref * B1_SIZE_8BIT + 8] = value;
        return this;
    }

    public setIsHighlighted(ref: tRef33, value: boolean): this {
        const pos = ref * B1_SIZE_8BIT + 9;
        this.v1Uint8[pos] = (this.v1Uint8[pos] & -2) | (+value & 1);
        return this;
    }

    public setIsAnimated(ref: tRef33, value: 0 | 1): this {
        const pos = ref * B1_SIZE_8BIT + 9;
        this.v1Uint8[pos] = (this.v1Uint8[pos] & -3) | ((+value & 1) << 1);
        return this;
    }

    public setSomething(ref: tRef33, value: MyEnum): this {
        this.v1Int8[ref * B1_SIZE_8BIT + 10] = value;
        return this;
    }
}

export class ComplexStructReader extends ComplexStructBase {

    private importDirtyView: Uint32Array;
    private imp0Int16: Int16Array;
    private imp1Uint32: Uint32Array;

    public import(data: ComplexStructExport, onChange?: (ref: tRef33) => void, onFullSync?: () => void) {

        if (this._max !== data.max) {
            this.realloc(data.max);
        }
        this._size = data.size;

        if (this.importDirtyView?.buffer !== data.transfer[0]) {
            this.importDirtyView = new Uint32Array(data.transfer[0]);
            this.imp0Int16 = new Int16Array(data.transfer[1]);
            this.imp1Uint32 = new Uint32Array(data.transfer[2]);
        }

        if (data.syncFull) {
            this.v0Int16.set(this.imp0Int16);
            this.v1Uint32.set(this.imp1Uint32);
            if (onFullSync) {
                onFullSync();
            } else if (onChange) {
                this.forEach(onChange);
            }
        } else {
            for (let i = 0; i < data.noOfDirty; ++i) {
                const ref = this.importDirtyView[i] as tRef33;
                const pos0 = ref * B0_SIZE_16BIT
                this.v0Int16[pos0] = this.imp0Int16[pos0];
                this.v0Int16[pos0 + 1] = this.imp0Int16[pos0 + 1];
                this.v0Int16[pos0 + 2] = this.imp0Int16[pos0 + 2];
                this.v0Int16[pos0 + 3] = this.imp0Int16[pos0 + 3];
                const pos1 = ref * B1_SIZE_32BIT
                this.v1Uint32[pos1] = this.imp1Uint32[pos1];
                this.v1Uint32[pos1 + 1] = this.imp1Uint32[pos1 + 1];
                this.v1Uint32[pos1 + 2] = this.imp1Uint32[pos1 + 2];
            }
            if (onChange) {
                for (let i = 0; i < data.noOfDirty; ++i) {
                    onChange?.(this.importDirtyView[i] as tRef33);
                }
            }
        }
    }
}
