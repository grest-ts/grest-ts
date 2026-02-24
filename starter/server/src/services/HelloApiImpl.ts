import type {HelloRequest, HelloResponse} from "@newproject/api/api/HelloApi"

export class HelloApiImpl {

    public hello = async (input: HelloRequest): Promise<HelloResponse> => {
        return {message: `Hello, ${input.name}!`}
    }
}
