import {Struct, typed} from "../../src/Struct";
import {tRef} from "./BasicStruct";

type tSubRef = number & { tRef: never };

// new Struct()
//     .ref<tRef>()
//     .buffer().int16("x")
//     .buffer().int16("y");

new Struct()
    .ref<tSubRef>()
    .buffer()
    .int16("x")
    .int16("y")
    .structArray("items", typed<tRef>())

