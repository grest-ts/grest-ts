import {NumberSchema} from "../schemas/IsNumber";

export const IsLatitude = new NumberSchema({type: 'number', min: -90, max: 90}).brand("latitude").docs({
    title: "Latitude",
    description: "Decimal degrees (-90 to 90)",
    example: 59.437
});
export type tLatitude = typeof IsLatitude.infer;
