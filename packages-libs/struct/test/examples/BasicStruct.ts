

export type tRef = number & { tRef: never };

const SIZE_16BIT = 2;

export interface BasicStructConfig {
    initialNumberOfObjects: number;
}

export class BasicStruct {

    private readonly _max: number;
    protected readonly vInt16: Int16Array

    constructor( config: BasicStructConfig ) {
        this._max = config.initialNumberOfObjects;
        this.vInt16 = new Int16Array(this._max * SIZE_16BIT)
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

    public setX(ref: tRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT] = value;
        return this;
    }

    public setY(ref: tRef, value: number): this {
        this.vInt16[ref * SIZE_16BIT + 1] = value;
        return this;
    }
}
