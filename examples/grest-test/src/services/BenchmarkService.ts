import {BenchmarkApiContract, BenchmarkRequest, BenchmarkResponse} from "../api/BenchmarkApi";
import {GGContractImplementation} from "@grest-ts/schema";

export class BenchmarkService implements GGContractImplementation<typeof BenchmarkApiContract["methods"]> {

    public async hello(request: BenchmarkRequest): Promise<BenchmarkResponse> {
        return {
            res: "Hello " + request.name
        };
    }
}
