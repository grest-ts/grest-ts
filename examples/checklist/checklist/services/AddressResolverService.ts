import {tLatitude, tLongitude} from "@grest-ts/schema";
import {GGLog} from "@grest-ts/logger";
import {mockable} from "@grest-ts/testkit-runtime";

export interface LatLng {
    lat: tLatitude;
    lng: tLongitude;
}

@mockable
export class AddressResolverService {
    /**
     * Resolves an address to lat/lng coordinates
     * @param address The address to geocode
     * @returns The latitude and longitude
     */
    async resolveAddress(address: string): Promise<LatLng> {
        // In a real implementation, this would call an external API
        // For this example, we return a fixed location (New York City)
        GGLog.debug(this, 'Resolving address: ' + address);

        // Simulate API delayre
        await new Promise(resolve => setTimeout(resolve, 10));

        return {
            lat: 40.7128 as tLatitude,
            lng: -74.0060 as tLongitude
        };
    }
}
