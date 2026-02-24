

export type tSubRef = number & { tRef: never };

const SIZE_16BIT = 2;

export interface SubStructConfig {
    initialNumberOfObjects: number;
}

export class SubStruct {

    private readonly _max: number;
    protected readonly vInt16: Int16Array

    constructor( config: SubStructConfig ) {
        this._max = config.initialNumberOfObjects;
        this.vInt16 = new Int16Array(this._max * SIZE_16BIT)
    }

    public get size(): number {
        return this._max;
    }

    public forEach(callback: (obj: tSubRef) => void) {
        for (let i = 0; i < this._max; i++) {
            callback(i as tSubRef);
        }
    }

    public getX(ref: tSubRef): number {
        return this.vInt16[ref * SIZE_16BIT];
    }

    public getY(ref: tSubRef): number {
        return this.vInt16[ref * SIZE_16BIT + 1];
    }

    public setX(ref: tSubRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT] = value;
        return this;
    }

    public setY(ref: tSubRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT + 1] = value;
        return this;
    }
}
