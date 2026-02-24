import {GGCallInterceptor, GGCallInterceptorConfig, GGTestRunner} from "@grest-ts/testkit";
import {GGEventsServer} from "./GGEventsServer";

export interface EventsInterceptorConfig extends GGCallInterceptorConfig {
    type: 'sns' | 'sqs';
    resourceName: string;
    eventType: string;
}

export class GGEventsInterceptor extends GGCallInterceptor {

    public readonly type: 'sns' | 'sqs';
    public readonly resourceName: string;
    public readonly eventType: string;

    constructor(test: GGTestRunner, config: EventsInterceptorConfig) {
        super(test, config);
        this.type = config.type;
        this.resourceName = config.resourceName;
        this.eventType = config.eventType;
    }

    public getKey(): string {
        return `${this.type}:${this.resourceName}:${this.eventType}`;
    }

    protected doRegister(): void {
        this.test.getExtensionInstance(GGEventsServer).addInterceptor(this);
    }

    protected doUnregister(): void {
        this.test.getExtensionInstance(GGEventsServer).deleteInterceptor(this);
    }

    /**
     * Check if this interceptor matches the given message.
     */
    public matches(message: any): boolean {
        return message?.type === this.eventType;
    }

    /**
     * Transform message to extract data payload for expectation checking.
     * User expectations are against `data`, not the full `{ type, data }` message.
     */
    protected transformInput(body: any): any {
        return body?.data;
    }

    protected parseResponseData(result: any): any {
        return result;
    }
}
