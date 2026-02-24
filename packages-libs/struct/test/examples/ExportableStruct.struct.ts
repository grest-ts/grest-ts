import {Struct} from "../../src/Struct";

type tRef = number & { tRef: never };

new Struct({useExport: true})
    .ref<tRef>()
    .buffer()
    .int16("x")
    .int16("y")
    .uint32("spriteId")
