General rules when working with code generation.

* We add import clauses only when we write something to the generated file. We never predict imports, always only when we really add them to the file.
* Each block of code ends with 2 new lines "\n\n". No new line at the start of a block.
* We reuse existing functionality, whenever writing some new traversal, parsing, generation code, we check if we already have functionality for it.
* Validators are generated using standard GenerateValidators class that all generators use.
* Interfaces, Errors, Custom validators are copied over using same class that all generators use.
* There are no semicolons in generated code (unless we literally copied over user made code from the source file).
* We should not fallback to "any" or "IsAny" in case we don't know how to handle something. We must throw generation error!
* We try to reuse existing functionality or when creating new functionality, we think we are duplicating same logic. If we are, we refactor and unify.
* In case of bigger updates - both expected file or generated file can contain mistakes. If difference is found, both should be logically analyzed for correctness.
* Only I can update expected files. If an issue is discovered, let me know about it. Only I can resolve it.

* Ideally when development ends, project should compile and all tests pass. In addition checklist project should be built (client, web-app, server) and server tests ran.
* In case of test failure, we should analyze what the issue as and if it is related to our changes.

* Do not write comments in the code. Only add a comment if the flow is complex or not obvious.