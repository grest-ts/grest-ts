import * as path from "node:path";
import {StructParser} from "../src/StructParser";

describe('usage', () => {

    it("build", () => {
        StructParser.build(path.dirname(__filename) + "/examples/", false)
    })

});
