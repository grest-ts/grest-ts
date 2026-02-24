import {BenchHelper} from "./BenchHelper";
import {tSpriteId} from "../test/examples/misc/MiscTypes";
import {AddableStruct, tRef} from "../test/examples/AddableStruct";

export function benchmarkAccess() {
    const anyNum = () => Math.floor(Math.random() * 10000);
    [1000, 10000, 100000, 1000000].forEach((NO_OF_OBJECTS) => {
        new BenchHelper("SimpleStructPool vs Objects (" + NO_OF_OBJECTS + ")")
            .addTestCase("Objects", () => {
                const data: { x: number, y: number, spriteId: number }[] = [];
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    data.push({
                        x: anyNum(),
                        y: anyNum(),
                        spriteId: anyNum(),
                    })
                }
                return () => {
                    for (let i = 0; i < NO_OF_OBJECTS; i++) {
                        const item = data[i];
                        item.x += 1;
                        item.y += 1;
                        item.spriteId = 1;
                    }
                }
            })
            .addTestCase("Pool method access", () => {
                const pool = new AddableStruct({initialNumberOfObjects: NO_OF_OBJECTS});
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    const ref = pool.new();
                    pool.setX(ref, anyNum())
                    pool.setY(ref, anyNum())
                    pool.setSpriteId(ref, anyNum() as tSpriteId)
                }
                return () => {
                    for (let i = 0; i < NO_OF_OBJECTS; i++) {
                        const ref = i as tRef
                        pool.addX(ref, 1)
                        pool.addY(ref, 1)
                        pool.setSpriteId(ref, 1 as tSpriteId)
                    }
                }
            })
            .addTestCase("Pool direct access", () => {

                const pool = new AddableStruct({initialNumberOfObjects: NO_OF_OBJECTS});
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    const ref = pool.new();
                    pool.setX(ref, anyNum())
                    pool.setY(ref, anyNum())
                    pool.setSpriteId(ref, anyNum() as tSpriteId)
                }

                return () => {
                    const v16 = (pool as any).vInt16;
                    const v32 = (pool as any).vUint32;
                    for (let i = 0; i < NO_OF_OBJECTS; i++) {
                        const ref = i as tRef
                        v16[ref * 4] += 1;
                        v16[ref * 4 + 1] += 1;
                        v32[ref * 2 + 1] = 1;
                    }
                }
            })
            .run();
    })
}