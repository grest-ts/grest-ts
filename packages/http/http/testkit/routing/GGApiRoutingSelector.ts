// Interface for API routing selector (test-only feature)
// Actual implementation is GGLocalRoutingStrategySelector from @grest-ts/discovery-local/testkit

export interface GGApiRoutingSelector {
    first(): void
    last(): void
    random(): void
    roundRobin(): void
    set(strategy: any): void
}
