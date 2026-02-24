import {AddableStruct} from "./examples/AddableStruct";
import {AddableExportableStruct} from "./examples/AddableExportableStruct";
import {AddableExportableDirtyStruct} from "./examples/AddableExportableDirtyStruct";
import {testInt16, testUint32} from "./helpers";

type REF = number

export interface AddableInterface {
    size: number,
    new: () => REF,
    free: (ref: REF) => void,
    exists: (ref: REF) => boolean,
    forEach: (callback: (ref: REF) => void) => void,
    setX: (ref: REF, value: number) => void,
    setY: (ref: REF, value: number) => void,
    setSpriteId: (ref: REF, value: number) => void,
    getX: (ref: REF) => number,
    getY: (ref: REF) => number,
    getSpriteId: (ref: REF) => number,
}

describe('Addable test', () => {

    it('AddableStruct', () => {
        test(new AddableStruct({initialNumberOfObjects: 2}));
    });

    it('AddableExportableStruct', () => {
        test(new AddableExportableStruct({initialNumberOfObjects: 2}));
    });

    it('AddableExportableDirtyStruct', () => {
        test(new AddableExportableDirtyStruct({initialNumberOfObjects: 2}));
    });

});

function test(master: AddableInterface) {

    const create = (expectedRef: number, expectedNoOfObjects: number) => {
        const ref = master.new();
        expect(ref).toEqual(expectedRef);
        expect(master.size).toEqual(expectedNoOfObjects);

        testInt16(master, "x", ref)
        testInt16(master, "y", ref)
        testUint32(master, "spriteId", ref)

        master.setX(ref, 1)
        master.setY(ref, 2);

        expect(master.exists(ref)).toEqual(false);
        master.setSpriteId(ref, 3);
        expect(master.exists(ref)).toEqual(true);

        return ref;
    }

    const ref = create(1, 1);

    // second object
    create(2, 2);

    // free first
    master.free(ref);
    expect(master.getX(ref)).toEqual(0);
    expect(master.getY(ref)).toEqual(0);
    expect(master.exists(ref)).toEqual(false);

    // third object (references first memory slot)
    create(1, 2);

    // force reallocation
    const ref3 = create(3, 3)
    const ref4 = create(4, 4)
    create(5, 5)

    master.free(ref3)
    master.free(ref4)

    create(4, 5) // We get last one that was free-d

    // loop
    const seen: number[] = [];
    master.forEach((ref) => seen.push(ref))
    expect(seen).toEqual([1, 2, 4, 5]);

}
