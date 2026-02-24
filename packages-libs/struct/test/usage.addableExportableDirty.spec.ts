import {tSpriteId} from "./examples/misc/MiscTypes";
import {AddableExportableDirtyStruct, AddableExportableDirtyStructReader} from "./examples/AddableExportableDirtyStruct";
import {SingleAddableExportableDirtyStruct, SingleAddableExportableDirtyStructReader} from "./examples/SingleAddableExportableDirtyStruct";
import {tRef33} from "./examples/ComplexStruct";

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
    setX: (ref: REF, value: number) => this,
    setY: (ref: REF, value: number) => this,
    setSpriteId: (ref: REF, value: number) => this,
    dirty: (ref: REF) => void
}

export interface ReaderInterface<T> extends BaseInterface {
    size: number;
    import: (data: T) => void
}

describe('Dirty test', () => {

    it('AddableExportableDirtyStruct', () => {
        const master = new AddableExportableDirtyStruct({initialNumberOfObjects: 2, fullSyncRatio: 0.7});
        const reader = new AddableExportableDirtyStructReader();
        test(master, reader);
    });

    it('AddableExportableDirtyStruct', () => {
        const master = new SingleAddableExportableDirtyStruct({initialNumberOfObjects: 2, fullSyncRatio: 0.7});
        const reader = new SingleAddableExportableDirtyStructReader();
        test(master, reader);
    });

});

function test<T>(master: MasterInterface<T>, reader: ReaderInterface<T>) {
    reader.import(master.export());
    expect(reader.size).toEqual(0)

    const ref1 = master.new()
    const ref2 = master.new()
    expect(ref1).toEqual(1)
    expect(ref2).toEqual(2)

    master.setX(ref1, 1).setY(ref1, 2).setSpriteId(ref1, 3 as tSpriteId).dirty(ref1);
    master.setX(ref2, 4).setY(ref2, 5).setSpriteId(ref2, 6 as tSpriteId).dirty(ref2)

    reader.import(master.export());

    expect(reader.size).toEqual(2)

    expect(reader.getX(ref1)).toEqual(1)
    expect(reader.getY(ref1)).toEqual(2)
    expect(reader.getSpriteId(ref1)).toEqual(3)

    expect(reader.getX(ref2)).toEqual(4)
    expect(reader.getY(ref2)).toEqual(5)
    expect(reader.getSpriteId(ref2)).toEqual(6)

    const ref3 = 3 as tRef33
    const ref4 = 4 as tRef33

    // Check ref3, ref4 empty

    expect(reader.getX(ref3)).toEqual(undefined)
    expect(reader.getY(ref3)).toEqual(undefined)
    expect(reader.getSpriteId(ref3)).toEqual(undefined)
    expect(reader.getX(ref4)).toEqual(undefined)
    expect(reader.getY(ref4)).toEqual(undefined)
    expect(reader.getSpriteId(ref4)).toEqual(undefined)

    // update one element and add another one.
    master.setX(ref2, 40).setY(ref2, 50).setSpriteId(ref2, 60 as tSpriteId).dirty(ref2)
    expect(master.new()).toEqual(ref3)
    master.setX(ref3, 7).setY(ref3, 8).setSpriteId(ref3, 9 as tSpriteId).dirty(ref3);
    reader.import(master.export());

    expect(reader.getX(ref2)).toEqual(40)
    expect(reader.getY(ref2)).toEqual(50)
    expect(reader.getSpriteId(ref2)).toEqual(60)

    expect(reader.getX(ref3)).toEqual(7)
    expect(reader.getY(ref3)).toEqual(8)
    expect(reader.getSpriteId(ref3)).toEqual(9)

    // update element without calling dirty
    master.setX(ref2, 400).setY(ref2, 500).setSpriteId(ref2, 600 as tSpriteId)
    expect(master.new()).toEqual(ref4)
    master.setX(ref4, 70).setY(ref4, 80).setSpriteId(ref4, 90 as tSpriteId)

    expect(reader.getX(ref2)).toEqual(40)
    expect(reader.getY(ref2)).toEqual(50)
    expect(reader.getSpriteId(ref2)).toEqual(60)

    expect(reader.getX(ref3)).toEqual(7)
    expect(reader.getY(ref3)).toEqual(8)
    expect(reader.getSpriteId(ref3)).toEqual(9)

    // loop
    const seen1: number[] = [];
    master.forEach((ref) => seen1.push(ref))
    expect(seen1).toEqual([1, 2, 3, 4]);

    const seen2: number[] = [];
    reader.forEach((ref) => seen2.push(ref))
    expect(seen2).toEqual([1, 2, 3]);
}
