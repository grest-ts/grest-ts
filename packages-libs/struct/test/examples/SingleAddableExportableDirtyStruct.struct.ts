import {ADD_MATH, MUST_EXIST, Struct, typed} from "../../src/Struct";
import {tSpriteId} from "./misc/MiscTypes";

type tRef33 = number & { tRef33: never };

new Struct({useDirty: true, useExport: true, useNew: true})
    .ref<tRef33>()
    .buffer().int16("x", ADD_MATH)
    .buffer().int16("y", ADD_MATH)
    .buffer().uint32("spriteId", MUST_EXIST, typed<tSpriteId>())

