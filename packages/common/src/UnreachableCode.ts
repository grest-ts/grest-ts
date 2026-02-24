export class UnreachableCode {
    public static never<T>(input: never, defaultValue?: T): T {
        return defaultValue;
    }

    public static throwNever<T>(input: never, defaultValue?: Error): T {
        throw defaultValue;
    }
}
