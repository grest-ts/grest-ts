import type {HelloRequest, HelloResponse} from "@newproject/api/api/HelloApi"
import {GreetingService} from "./GreetingService"

export class HelloApiImpl {

    constructor(private readonly greetingService: GreetingService) {}

    public hello = async (input: HelloRequest): Promise<HelloResponse> => {
        return {message: await this.greetingService.format(input.name)}
    }
}
