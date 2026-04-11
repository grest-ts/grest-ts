import {mockable} from "@grest-ts/testkit-runtime"

@mockable
export class GreetingService {
    async format(name: string): Promise<string> {
        return `Hello, ${name}!`
    }
}
