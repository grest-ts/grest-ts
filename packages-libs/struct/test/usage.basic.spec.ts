import {BasicStruct, tRef} from "./examples/BasicStruct";

describe('Basic test', () => {

    it('BasicStruct', () => {
        const confFixed = {initialNumberOfObjects: 4};
        const master = new BasicStruct(confFixed);

        const ref1 = 0 as tRef
        const ref2 = 1 as tRef
        const ref3 = 2 as tRef
        const ref4 = 3 as tRef

        master.setX(ref1, 1).setY(ref1, 2)
        master.setX(ref2, 4).setY(ref2, 5)

        expect(master.size).toEqual(4)
        expect(master.getX(ref1)).toEqual(1)
        expect(master.getY(ref1)).toEqual(2)
        expect(master.getX(ref2)).toEqual(4)
        expect(master.getY(ref2)).toEqual(5)
        expect(master.getX(ref3)).toEqual(0)
        expect(master.getY(ref3)).toEqual(0)
        expect(master.getX(ref4)).toEqual(0)
        expect(master.getY(ref4)).toEqual(0)

        // update one element and add another one.
        master.setX(ref2, 40).setY(ref2, 50)

        expect(master.size).toEqual(4)
        expect(master.getX(ref1)).toEqual(1)
        expect(master.getY(ref1)).toEqual(2)
        expect(master.getX(ref2)).toEqual(40)
        expect(master.getY(ref2)).toEqual(50)
        expect(master.getX(ref3)).toEqual(0)
        expect(master.getY(ref3)).toEqual(0)
        expect(master.getX(ref4)).toEqual(0)
        expect(master.getY(ref4)).toEqual(0)


        // loop
        const seen: number[] = [];
        master.forEach((ref) => seen.push(ref))
        expect(seen).toEqual([0, 1, 2, 3]);
    });

});

