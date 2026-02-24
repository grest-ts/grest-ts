import {ExportableStruct, ExportableStructReader} from "./examples/ExportableStruct";
import {ExportableDirtyStruct, ExportableDirtyStructReader} from "./examples/ExportableDirtyStruct";
import {tSpriteId} from "./examples/misc/MiscTypes";

type REF = number

export interface BaseInterface {
    getX: (ref: REF) => number,
    getY: (ref: REF) => number,
    getSpriteId: (ref: REF) => number,
    forEach: (callback: (ref: REF) => void) => void
}

export interface MasterInterface<T> extends BaseInterface {
    size: number;
    export: () => T,
    setX: (ref: REF, value: number) => void,
    setY: (ref: REF, value: number) => void,
    setSpriteId: (ref: REF, value: number) => void,
}

export interface ReaderInterface<T> extends BaseInterface {
    size: number;
    import: (data: T) => void
}

function fillFixed<T extends MasterInterface<any>>(pool: T): T {
    for (let i = 0; i < 10; i++) {
        pool.setX(i, i * 3);
        pool.setY(i, i * 3 + 1);
        pool.setSpriteId(i, i * 3 + 2 as tSpriteId);
    }
    return pool;
}

describe('Exportable test', () => {

    const confFixed = {initialNumberOfObjects: 10};

    it('ExportableStruct', () => {
        test(fillFixed(new ExportableStruct(confFixed)), new ExportableStructReader(confFixed));
    });

    it('ExportableDirtyStruct', () => {
        test(fillFixed(new ExportableDirtyStruct(confFixed)), new ExportableDirtyStructReader(confFixed));
    });

});


function test<T>(master: MasterInterface<T>, reader: ReaderInterface<T>) {

    reader.import(master.export());
    expect(reader.size).toEqual(10)

    expect(reader.getX(0)).toEqual(0)
    expect(reader.getY(0)).toEqual(1)
    expect(reader.getSpriteId(0)).toEqual(2)

    expect(reader.getX(1)).toEqual(3)
    expect(reader.getY(1)).toEqual(4)
    expect(reader.getSpriteId(1)).toEqual(5)

    expect(reader.getX(9)).toEqual(27)
    expect(reader.getY(9)).toEqual(28)
    expect(reader.getSpriteId(9)).toEqual(29)

    expect(reader.getX(-1)).toEqual(undefined)
    expect(reader.getY(-1)).toEqual(undefined)
    expect(reader.getSpriteId(-1)).toEqual(undefined)

    expect(reader.getX(10)).toEqual(undefined)
    expect(reader.getY(10)).toEqual(undefined)
    expect(reader.getSpriteId(10)).toEqual(undefined)

    // loop
    const seen1: number[] = [];
    master.forEach((ref) => seen1.push(ref))
    expect(seen1).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const seen2: number[] = [];
    reader.forEach((ref) => seen2.push(ref))
    expect(seen2).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // 3 is defined because it is fixed size pool.

}
