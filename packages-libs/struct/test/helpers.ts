const int16AMax = 2 ** 15 - 1;
const int16AMin = -(2 ** 15);

export function testInt16(pool: any, varName: string, ref: number) {

    const set = "set" + ucFirst(varName);
    const get = "get" + ucFirst(varName);

    pool[set](ref, int16AMin)
    expect(pool[get](ref)).toEqual(int16AMin);
    pool[set](ref, int16AMin - 1)
    expect(pool[get](ref)).toEqual(int16AMax);
    pool[set](ref, int16AMax + 1)
    expect(pool[get](ref)).toEqual(int16AMin);

}

const uint32Max = 2 ** 32 - 1;

export function testUint32(pool: any, varName: string, ref: number) {

    const set = "set" + ucFirst(varName);
    const get = "get" + ucFirst(varName);

    pool[set](ref, 0)
    expect(pool[get](ref)).toEqual(0);
    pool[set](ref, -1)
    expect(pool[get](ref)).toEqual(uint32Max);
    pool[set](ref, uint32Max)
    expect(pool[get](ref)).toEqual(uint32Max);
    pool[set](ref, uint32Max + 1)
    expect(pool[get](ref)).toEqual(0);
}

function ucFirst(val: string): string {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}