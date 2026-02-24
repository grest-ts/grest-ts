import {tSpriteId} from "./misc/MiscTypes";

export type tRef = number & { tRef: never };

const SIZE_32BIT = 2;
const SIZE_16BIT = 4;

abstract class AddableExportableStructBase {

    protected _size: number = 0;
    protected _max: number;
    protected vUint32: Uint32Array
    protected vInt16: Int16Array

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

    public forEach(callback: (ref: tRef) => void) {
        const end = this._size;
        for ( let ref = 1; ref <= end; ref++) {
            if (this.vUint32[ref * SIZE_32BIT + 1] !== 0) {
                callback(ref as tRef);
            }
        }
    }

    public exists(ref: tRef): boolean {
        return this.vUint32[ref * SIZE_32BIT + 1] !== 0
    }

    public getX(ref: tRef): number {
        return this.vInt16[ref * SIZE_16BIT];
    }

    public getY(ref: tRef): number {
        return this.vInt16[ref * SIZE_16BIT + 1];
    }

    public getSpriteId(ref: tRef): tSpriteId {
        return this.vUint32[ref * SIZE_32BIT + 1] as tSpriteId;
    }
}

export interface AddableExportableStructExport {
    _exportOf_AddableExportableStruct: never;
    max: number;
    size: number;
    transfer: ArrayBuffer[]
}

export interface AddableExportableStructConfig {
    initialNumberOfObjects: number;
}

export class AddableExportableStruct extends AddableExportableStructBase {

    private config: AddableExportableStructConfig;

    constructor(config: AddableExportableStructConfig) {
        super();
        this.config = config;
        this.realloc(this.config.initialNumberOfObjects);
    }

    private readonly freeIds: tRef[] = [];

    public new(): tRef {
        if (this.freeIds.length > 0) {
            return this.freeIds.pop();
        } else {
            if (this._size === this._max) {
                this.realloc(this._max * 2);
            }
            return ++this._size as tRef;
        }
    }

    public free(ref: tRef): void {
        this.vUint32.fill(0, ref * SIZE_32BIT, (ref + 1) * SIZE_32BIT);
        this.freeIds.push(ref);
    }

    private exportMsg: AddableExportableStructExport = {max: 0, size: 0, transfer: []} as AddableExportableStructExport;
    private exportViewsMaxNoOfObjects: number;
    private expUint32: Uint32Array;

    public export(): AddableExportableStructExport {
         if (this.exportViewsMaxNoOfObjects !== this._max) {
            this.exportViewsMaxNoOfObjects = this._max;
            this.expUint32 = new Uint32Array(this.vUint32.length);
            this.exportMsg.transfer[0] = this.expUint32.buffer as ArrayBuffer;
        }

        const msg = this.exportMsg;
        msg.max = this._max;
        msg.size = this._size;
        this.expUint32.set(this.vUint32);

        return msg;
    }

    public setX(ref: tRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT] = value;
        return this;
    }

    public addX(ref: tRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT] += value;
        return this;
    }

    public setY(ref: tRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT + 1] = value;
        return this;
    }

    public addY(ref: tRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT + 1] += value;
        return this;
    }

    public setSpriteId(ref: tRef, value: tSpriteId): this {
        this.vUint32[ref * SIZE_32BIT + 1] = value;
        return this;
    }
}

export class AddableExportableStructReader extends AddableExportableStructBase {

    private impUint32: Uint32Array;

    public import(data: AddableExportableStructExport, onChange?: (ref: tRef) => void, onFullSync?: () => void) {

        if (this._max !== data.max) {
            this.realloc(data.max);
            this.impUint32 = new Uint32Array(data.transfer[0]);
        }
        this._size = data.size;

        this.vUint32.set(this.impUint32);
        if (onFullSync) {
            onFullSync();
        } else if (onChange) {
            this.forEach(onChange);
        }
    }
}
