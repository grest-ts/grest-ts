import {ADD_MATH, MUST_EXIST, Struct, typed} from "../../src/Struct";
import {tSpriteId} from "./misc/MiscTypes";

type tRef33 = number & { tRef33: never };

export enum MyEnum {
    A = 10,
    B = 20
}

new Struct({useDirty: true, useExport: true, useNew: true})
    .ref<tRef33>()
    .buffer()
    .int16("x", ADD_MATH)
    .int16("y", ADD_MATH)
    .uint16("width")
    .uint16("height")
    .buffer()
    .uint32("clickId")
    .uint16("spriteId", MUST_EXIST, typed<tSpriteId>())
    .uint8("tileX")
    .uint8("tileY")
    .uint8("opacity", 1)
    .bool("isHighlighted")
    .bit("isAnimated")
    .int8("something", typed<MyEnum>())
