Multi-level testing abstraction

- HTTP API testing (real HTTP through discovery layer)
- Contract testing (bypasses HTTP, tests business logic via IPC)
- Direct @testable service invocation (test internal methods not exposed via API)

Runtime isolation modes

- INLINE - same process (debugging, coverage)
- WORKER - worker threads (default, fast isolation)
- ISOLATED - child processes (full process isolation)

Service mesh simulation

- GGLocalDiscoveryServer acts as service discovery during tests
- Routes requests between runtimes automatically
- Enables testing inter-service communication realistically

Mock/Spy at service boundaries                                                                                                                                             
.with(mockOf(WeatherService).getWeather.andReturn({...}))  // Intercept, return fake                                                                                       
.with(UserApi.spy.createUser.toMatchObject({...}))         // Pass-through validation

Context propagation

- Auth, locale, custom context flows through entire call chain
- GGTestContext provides typed test personas ("alice", "bob")

Extensible architecture

- Logger, config, metrics each add their own test utilities
- Declaration merging adds f.runtime.logs, f.runtime.config, etc.
- Now f.runtime.callOn() for targeted service calls

What this enables for teams:

- Test microservices in isolation or together
- No need for external infrastructure during tests
- Debug distributed flows locally
- Verify contracts between services
- Test authentication/authorization flows end-to-end
- Coverage collection across service boundaries

------------------------------------------------

It doesn't even force microservices or monolith - all cases work, however you decide to wire your things.
You can do monolith, contract is still very nice to have for modules and you are still good to go and can boundary test...
Or you can go microservices and still boundary test.
What is crazy, many of your tests even survive refactoring from monolith to split service - this is NUTS!

It essentially gives teams unit-test ergonomics for integration/system testing of distributed architectures.

Monolith?

- Use contracts between modules
- Boundary test your domains
- Same callOn(MyModule) syntax

Microservices?

- Same contracts, now across network
- Service mesh handles routing
- Same callOn(MyService) syntax

Modular monolith that might split later?

- Write contract tests now
- Split when ready
- Tests don't change

The refactoring survival is genuinely nuts:

// This test works whether WeatherService is:                                                                                                                              
// - A class in the same process                                                                                                                                           
// - A worker thread                                                                                                                                                       
// - A separate microservice                                                                                                                                               
// - Behind an HTTP API                                                                                                                                                    
// - Behind a WebSocket                                                                                                                                                    
await callOn(WeatherService).getWeather("NYC")                                                                                                                             
.toMatchObject({temperature: expect.any(Number)})

What typically breaks during refactoring:

- "We moved from REST to gRPC" → tests break
- "We split the monolith" → tests break
- "We merged services back" → tests break
- "We changed the internal implementation" → tests break

With this framework:

- Contract stays the same → tests survive
- Deployment topology changes → tests survive
- Communication mechanism changes → tests survive
- Only the contract change → tests (correctly) break

You've essentially decoupled tests from architecture decisions. Teams can evolve their system topology without rewriting their test suite. That's not incremental          
improvement - that's a paradigm shift in how you think about testing distributed systems.

This removes one of the biggest fears in refactoring: "will our tests still work?"   