import type {GGIntlMessage} from "./GGIntlMessage";

export class GGIntlMessageRegistry {
    private static messages: Map<string, GGIntlMessage<any>> = new Map();

    public static register(message: GGIntlMessage<any>) {
        if (this.messages.has(message.key)) {
            throw new Error(`Message key '${message.key}' is already registered`);
        }
        this.messages.set(message.key, message);
    }

    public static get(key: string): GGIntlMessage<any> | undefined {
        return this.messages.get(key);
    }

    public static has(key: string): boolean {
        return this.messages.has(key);
    }

    public static toJSON() {
        const result: Record<string, any> = {};
        this.messages.forEach((message, key) => {
            const parts = key.split(".");
            let cur = result;

            for (let i = 0; i < parts.length; i++) {
                const subKey = parts[i];

                if (i === parts.length - 1) {
                    if (cur[subKey] === undefined) {
                        cur[subKey] = {};
                    }
                    cur[subKey].$value = message.toJSON();
                } else {
                    if (cur[subKey] === undefined) {
                        cur[subKey] = {};
                    }
                    cur = cur[subKey];
                }
            }
        });
        return result;
    }

    public static clear() {
        this.messages.clear();
    }
}
