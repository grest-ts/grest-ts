import {Struct} from "../../src/Struct";

type tRef = number & { tRef: never };

// new Struct()
//     .ref<tRef>()
//     .buffer().int16("x")
//     .buffer().int16("y");

new Struct()
    .ref<tRef>()
    .buffer()
    .int16("x")
    .int16("y");

