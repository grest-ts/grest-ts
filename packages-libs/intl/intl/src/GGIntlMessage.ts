import {GGIntlMessageRegistry} from "./GGIntlMessageRegistry";

import {GG_INTL} from "./GG_INTL";

/** Maps param keys to string descriptions */
type ParamDescriptions<T> = { [K in keyof T]: string };

/**
 * Internationalized message descriptor with typed parameters.
 *
 * @template TParams - Object type for message parameters. Use `{}` (default) for no params.
 *
 * @example
 * // Message without params
 * const welcome = new GGIntlMessage("auth.welcome", "Welcome!");
 * welcome.t();
 *
 * // Message with params
 * const greeting = new GGIntlMessage<{name: string}>(
 *   "auth.greeting",
 *   "Hello, {name}!",
 *   { name: "User's display name" }
 * );
 * greeting.t({ name: "John" });
 */
export class GGIntlMessage<TParams extends object = {}> {
    public readonly key: string;
    public readonly defaultMessage: string;
    public readonly paramDescriptions?: ParamDescriptions<TParams>;

    constructor(
        key: string,
        defaultMessage: string,
        ...paramDescriptions: keyof TParams extends never ? [] : [params: ParamDescriptions<TParams>]
    ) {
        this.key = key;
        this.defaultMessage = defaultMessage;
        this.paramDescriptions = paramDescriptions[0] as any;
        GGIntlMessageRegistry.register(this);
    }

    /**
     * Translate using context language.
     */
    public t(...args: keyof TParams extends never ? [] : [params: TParams]): string {
        return GG_INTL.get().t(this.key, args[0]);
    }

    /**
     * Translate using system language (for logs, debugging).
     */
    public system(...args: keyof TParams extends never ? [] : [params: TParams]): string {
        return GG_INTL.get().system(this.key, args[0]);
    }

    /**
     * Translate with a specific locale.
     */
    public format(locale: string, ...args: keyof TParams extends never ? [] : [params: TParams]): string {
        return GG_INTL.get().format(locale, this.key, args[0]);
    }

    public toJSON() {
        return {
            key: this.key,
            defaultMessage: this.defaultMessage,
            params: this.paramDescriptions
        };
    }
}
