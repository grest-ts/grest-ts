import {ADD_MATH, MUST_EXIST, Struct, typed} from "../../src/Struct";
import {tSpriteId} from "./misc/MiscTypes";

type tRef = number & { tRef: never };

new Struct({useExport: true, useNew: true})
    .ref<tRef>()
    .buffer()
    .int16("x", ADD_MATH)
    .int16("y", ADD_MATH)
    .uint32("spriteId", MUST_EXIST, typed<tSpriteId>())
