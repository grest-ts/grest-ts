

export type tRef = number & { tRef: never };

const SIZE_32BIT = 2;
const SIZE_16BIT = 4;

export interface ExportableStructExport {
    _exportOf_ExportableStruct: never;
    transfer: ArrayBuffer[]
}

export interface ExportableStructConfig {
    initialNumberOfObjects: number;
}

abstract class ExportableStructBase {

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

export class ExportableStruct extends ExportableStructBase {

    private readonly exportMsg: ExportableStructExport = {transfer: []} as unknown as ExportableStructExport;
    private readonly expUint32!: Uint32Array;

    constructor(config: ExportableStructConfig) {
        super(config.initialNumberOfObjects);
        this.expUint32 = new Uint32Array(this.vUint32.length);
        this.exportMsg.transfer[0] = this.expUint32.buffer as ArrayBuffer;
    }

    public export(): ExportableStructExport {
        const msg = this.exportMsg;
        this.expUint32.set(this.vUint32);
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

export class ExportableStructReader extends ExportableStructBase {

    private initialized: boolean = false;
    private impUint32!: Uint32Array;

    constructor(config: ExportableStructConfig) {
        super(config.initialNumberOfObjects);
    }

    public import(data: ExportableStructExport, onFullSync?: () => void) {
        if (!this.initialized) {
            this.initialized = true;
            this.impUint32 = new Uint32Array(data.transfer[0]);
        }
        this.vUint32.set(this.impUint32);
        onFullSync?.();
    }
}
