import {tSpriteId} from "./misc/MiscTypes";

export type tRef = number & { tRef: never };

const SIZE_32BIT = 2;
const SIZE_16BIT = 4;

export interface AddableStructConfig {
    initialNumberOfObjects: number;
}

export class AddableStruct {

    private _size: number = 0;
    private _max: number;
    protected vUint32: Uint32Array
    protected vInt16: Int16Array

    constructor( config: AddableStructConfig ) {
        this.realloc(config.initialNumberOfObjects);
    }

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

    public getX(ref: tRef): number {
        return this.vInt16[ref * SIZE_16BIT];
    }

    public getY(ref: tRef): number {
        return this.vInt16[ref * SIZE_16BIT + 1];
    }

    public getSpriteId(ref: tRef): tSpriteId {
        return this.vUint32[ref * SIZE_32BIT + 1] as tSpriteId;
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
