import {ExportableDirtyStruct, ExportableDirtyStructReader, tRef} from "./examples/ExportableDirtyStruct";
import {tSpriteId} from "./examples/misc/MiscTypes";

describe('Dirty test', () => {

    it('ExportableDirtyStruct', () => {
        const confFixed = {initialNumberOfObjects: 4, fullSyncRatio: 0.7};
        const master = new ExportableDirtyStruct(confFixed);
        const reader = new ExportableDirtyStructReader(confFixed);

        reader.import(master.export());
        expect(reader.size).toEqual(4)

        const ref1 = 0 as tRef
        const ref2 = 1 as tRef
        const ref3 = 2 as tRef
        const ref4 = 3 as tRef

        master.setX(ref1, 1).setY(ref1, 2).setSpriteId(ref1, 3 as tSpriteId).dirty(ref1);
        master.setX(ref2, 4).setY(ref2, 5).setSpriteId(ref2, 6 as tSpriteId).dirty(ref2)
        reader.import(master.export());

        expect(reader.size).toEqual(4)
        expect(reader.getX(ref1)).toEqual(1)
        expect(reader.getY(ref1)).toEqual(2)
        expect(reader.getSpriteId(ref1)).toEqual(3)
        expect(reader.getX(ref2)).toEqual(4)
        expect(reader.getY(ref2)).toEqual(5)
        expect(reader.getSpriteId(ref2)).toEqual(6)
        expect(reader.getX(ref3)).toEqual(0)
        expect(reader.getY(ref3)).toEqual(0)
        expect(reader.getSpriteId(ref3)).toEqual(0)
        expect(reader.getX(ref4)).toEqual(0)
        expect(reader.getY(ref4)).toEqual(0)
        expect(reader.getSpriteId(ref4)).toEqual(0)

        // update one element and add another one.
        master.setX(ref2, 40).setY(ref2, 50).setSpriteId(ref2, 60 as tSpriteId).dirty(ref2)
        master.setX(ref3, 7).setY(ref3, 8).setSpriteId(ref3, 9 as tSpriteId).dirty(ref3);
        reader.import(master.export());

        expect(reader.size).toEqual(4)
        expect(reader.getX(ref1)).toEqual(1)
        expect(reader.getY(ref1)).toEqual(2)
        expect(reader.getSpriteId(ref1)).toEqual(3)
        expect(reader.getX(ref2)).toEqual(40)
        expect(reader.getY(ref2)).toEqual(50)
        expect(reader.getSpriteId(ref2)).toEqual(60)
        expect(reader.getX(ref3)).toEqual(7)
        expect(reader.getY(ref3)).toEqual(8)
        expect(reader.getSpriteId(ref3)).toEqual(9)
        expect(reader.getX(ref4)).toEqual(0)
        expect(reader.getY(ref4)).toEqual(0)
        expect(reader.getSpriteId(ref4)).toEqual(0)

        // update element without calling dirty
        master.setX(ref4, 70).setY(ref4, 80).setSpriteId(ref4, 90 as tSpriteId)

        expect(reader.size).toEqual(4)
        expect(reader.getX(ref1)).toEqual(1)
        expect(reader.getY(ref1)).toEqual(2)
        expect(reader.getSpriteId(ref1)).toEqual(3)
        expect(reader.getX(ref2)).toEqual(40)
        expect(reader.getY(ref2)).toEqual(50)
        expect(reader.getSpriteId(ref2)).toEqual(60)
        expect(reader.getX(ref3)).toEqual(7)
        expect(reader.getY(ref3)).toEqual(8)
        expect(reader.getSpriteId(ref3)).toEqual(9)
        expect(reader.getX(ref4)).toEqual(0)
        expect(reader.getY(ref4)).toEqual(0)
        expect(reader.getSpriteId(ref4)).toEqual(0)

        // loop
        const seen1: number[] = [];
        master.forEach((ref) => seen1.push(ref))
        expect(seen1).toEqual([0, 1, 2, 3]);

        const seen2: number[] = [];
        reader.forEach((ref) => seen2.push(ref))
        expect(seen2).toEqual([0, 1, 2, 3]); // 3 is defined because it is fixed size pool.
    });

});

