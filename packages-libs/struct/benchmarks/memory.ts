import {tSpriteId} from "../test/examples/misc/MiscTypes";
import {AddableStruct} from "../test/examples/AddableStruct";

const anyNum = () => Math.floor(Math.random() * 10000);

const NO_OF_OBJECTS = 10000000;
// pool: 113MB
// objects: 950MB

function makeObjects() {
    const data: { x: number, y: number, spriteId: number }[] = [];
    for (let i = 0; i < NO_OF_OBJECTS; i++) {
        data.push({
            x: anyNum(),
            y: anyNum(),
            spriteId: anyNum(),
        })
    }
    return data;
}

function makePool() {
    const pool = new AddableStruct({initialNumberOfObjects: NO_OF_OBJECTS});
    for (let i = 0; i < NO_OF_OBJECTS; i++) {
        const ref = pool.new();
        pool.setX(ref, anyNum())
        pool.setY(ref, anyNum())
        pool.setSpriteId(ref, anyNum() as tSpriteId)
    }
}

const arg = process.argv[2];
let f: any;
if (arg === "objects") {
    f = makeObjects();
} else if (arg === "pool") {
    f = makePool();
} else {
    console.log("Add argument - objects or pool")
}
console.log("Data created");

setInterval(() => {
    String(f)
    console.log("check memory usage...")
}, 5000)