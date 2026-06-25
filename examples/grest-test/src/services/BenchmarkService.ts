import {BenchmarkApiContract, BenchmarkRequest, BenchmarkResponse} from "../api/BenchmarkApi";

type IBenchmarkApi = typeof BenchmarkApiContract.infer

export class BenchmarkService implements IBenchmarkApi {

    public async hello(request: BenchmarkRequest): Promise<BenchmarkResponse> {
        return {
            res: "Hello " + request.name
        };
    }
}
