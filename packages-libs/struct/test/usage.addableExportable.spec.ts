import {AddableExportableStruct, AddableExportableStructReader} from "./examples/AddableExportableStruct";
import {AddableExportableDirtyStruct, AddableExportableDirtyStructReader} from "./examples/AddableExportableDirtyStruct";
import {tSpriteId} from "./examples/misc/MiscTypes";
import {SingleAddableExportableDirtyStruct, SingleAddableExportableDirtyStructReader} from "./examples/SingleAddableExportableDirtyStruct";

type REF = number;

export interface BaseInterface {
    getX: (ref: REF) => number,
    getY: (ref: REF) => number,
    getSpriteId: (ref: REF) => number,
    forEach: (callback: (ref: REF) => void) => void
}

export interface MasterInterface<T> extends BaseInterface {
    size: number;
    new: () => REF
    export: () => T,
    setX: (ref: REF, value: number) => void,
    setY: (ref: REF, value: number) => void,
    setSpriteId: (ref: REF, value: number) => void,
}

export interface ReaderInterface<T> extends BaseInterface {
    size: number;
    import: (data: T) => void
}

function fillAddable<T extends MasterInterface<any>>(pool: T): T {
    for (let i = 0; i < 10; i++) {
        const ref = pool.new();
        pool.setX(ref, i * 3);
        pool.setY(ref, i * 3 + 1);
        pool.setSpriteId(ref, i * 3 + 2 as tSpriteId);
    }
    return pool;
}

describe('Exportable test', () => {

    const confAddable = {initialNumberOfObjects: 5}; // This is important, as it creates initially pool of 5 and then multiplies to 10;

    it('AddableExportableStruct', () => {
        test(fillAddable(new AddableExportableStruct(confAddable)), new AddableExportableStructReader());
    });

    it('AddableExportableDirtyStruct', () => {
        test(fillAddable(new AddableExportableDirtyStruct(confAddable)), new AddableExportableDirtyStructReader());
    });

    it('AddableExportableDirtyStruct', () => {
        test(fillAddable(new SingleAddableExportableDirtyStruct(confAddable)), new SingleAddableExportableDirtyStructReader());
    });
});


function test<T>(master: MasterInterface<T>, reader: ReaderInterface<T>) {

    reader.import(master.export());
    expect(reader.size).toEqual(10)

    // For addable first element is not set, this is 0 and is valid.
    // ID-s start from 1 and actual buffer size is noOfObjects + 1
    expect(reader.getX(0)).toEqual(0)
    expect(reader.getY(0)).toEqual(0)
    expect(reader.getSpriteId(0)).toEqual(0)

    expect(reader.getX(1)).toEqual(0)
    expect(reader.getY(1)).toEqual(1)
    expect(reader.getSpriteId(1)).toEqual(2)

    expect(reader.getX(10)).toEqual(27)
    expect(reader.getY(10)).toEqual(28)
    expect(reader.getSpriteId(10)).toEqual(29)

    expect(reader.getX(-1)).toEqual(undefined)
    expect(reader.getY(-1)).toEqual(undefined)
    expect(reader.getSpriteId(-1)).toEqual(undefined)

    expect(reader.getX(11)).toEqual(undefined)
    expect(reader.getY(11)).toEqual(undefined)
    expect(reader.getSpriteId(11)).toEqual(undefined)

    // loop
    const seen: number[] = [];
    master.forEach((ref) => seen.push(ref))
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);


}
