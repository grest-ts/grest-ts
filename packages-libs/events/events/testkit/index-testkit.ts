export * from "./GGEventsServer"
export * from "./GGEventsInterceptor"
export * from "./GGEventsCommands"

// Extensions - modify prototypes, not exported
import "./EventPublisherResource.mock"
import "./EventSubscriberResource.mock"

// Patch all adapters to use test implementations (single file replaces multiple override files)
import "./TestPublisherAdapter"
import "./TestSubscriberAdapter"
