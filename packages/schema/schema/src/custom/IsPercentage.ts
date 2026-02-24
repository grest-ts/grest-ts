import {NumberSchema} from "../schemas/IsNumber";

export const IsPercentage = new NumberSchema({type: 'number', min: 0, max: 100}).brand("percentage").docs({
    title: "Percentage",
    description: "Value between 0 and 100",
    example: 50
});
export type tPercentage = typeof IsPercentage.infer;