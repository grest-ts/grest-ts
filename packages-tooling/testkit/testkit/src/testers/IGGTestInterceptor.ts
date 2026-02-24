export interface IGGTestInterceptor {
    register(): void | Promise<void>;

    unregister(): void | Promise<void>;

    validate(): void | Promise<void>;

    getMockValidationError(): Error | undefined;

    isCalled(): boolean;
}