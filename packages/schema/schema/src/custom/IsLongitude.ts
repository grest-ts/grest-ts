import {NumberSchema} from "../schemas/IsNumber";

export const IsLongitude = new NumberSchema({type: 'number', min: -180, max: 180}).brand("longitude").docs({
    title: "Longitude",
    description: "Decimal degrees (-180 to 180)",
    example: 24.754
});
export type tLongitude = typeof IsLongitude.infer;