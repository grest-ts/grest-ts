import {BenchHelper} from "./BenchHelper";
import {tSpriteId} from "../test/examples/misc/MiscTypes";
import {AddableExportableDirtyStruct, AddableExportableDirtyStructReader, tRef33} from "../test/examples/AddableExportableDirtyStruct";

export function benchmarkExport() {
    const anyNum = () => Math.floor(Math.random() * 10000);

    [1000, 10000, 100000, 1000000].forEach((NO_OF_OBJECTS) => {
        const conf = {
            initialNumberOfObjects: NO_OF_OBJECTS,
            fullSyncRatio: 0.35 // This ratio last time balanced out with FULL_SYNC
        };
        const NO_OF_CHANGES = Math.floor(NO_OF_OBJECTS * conf.fullSyncRatio) - 1
        const ID = 5 as tRef33;

        const run = (
            pool1: AddableExportableDirtyStruct,
            pool2: AddableExportableDirtyStructReader,
            noOfChanges: number
        ) => {
            for (let i = 0; i < NO_OF_OBJECTS; i++) {
                const ref = pool1.new();
                pool1.setX(ref, anyNum())
                pool1.setY(ref, anyNum())
                pool1.setSpriteId(ref, 1000 as tSpriteId)
            }

            pool1.setX(ID, 10)
            pool2.import(pool1.export());

            return () => {
                for (let i = 0; i < noOfChanges; i++) {
                    pool1.dirty(i as tRef33)
                }
                const data = pool1.export();
                let f = 0;
                pool2.import(data, () => f++);
                String(f)
            }
        }

        new BenchHelper("Export (" + NO_OF_OBJECTS + ")", {runs: 20, warmRuns: 1})
            .addTestCase("TEST GEN FULL", () => {
                const pool1 = new AddableExportableDirtyStruct(conf);
                const pool2 = new AddableExportableDirtyStructReader();
                return run(pool1, pool2, NO_OF_OBJECTS);
            })
            .addTestCase("TEST GEN", () => {
                const pool1 = new AddableExportableDirtyStruct(conf);
                const pool2 = new AddableExportableDirtyStructReader();
                return run(pool1, pool2, NO_OF_CHANGES);
            })

            .run();
    });


}