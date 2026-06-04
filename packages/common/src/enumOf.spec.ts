import {enumOf} from "./enumOf";
import type {Values} from "./types";

describe("enumOf", () => {
    const Color = enumOf({
        Red: "red",
        Green: "green",
        Blue: "blue",
    });
    type Color = Values<typeof Color>;

    it("preserves keys and values", () => {
        expect(Color.Red).toBe("red");
        expect(Object.values(Color)).toEqual(["red", "green", "blue"]);
    });

    it("freezes the object", () => {
        expect(Object.isFrozen(Color)).toBe(true);
        expect(() => {
            (Color as any).Red = "x";
        }).toThrow();
    });

    it("keeps literal types", () => {
        expectTypeOf(Color.Red).toEqualTypeOf<"red">();
        expectTypeOf<Color>().toEqualTypeOf<"red" | "green" | "blue">();
    });
});
