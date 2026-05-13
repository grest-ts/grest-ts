## Custom Loggers

Implement `GGLogger` interface:

```typescript
import {GGLogger, LogEntry, LogLevel} from "@grest-ts/logger"

export class MyCustomLogger implements GGLogger {
    minLevel = LogLevel.INFO

    log(entry: LogEntry): void {
        // Send to external service
        myLoggingService.send({
            level: entry.level,
            message: entry.message,
            context: entry.contextName,
            data: entry.data,
            error: entry.error?.message,
            timestamp: entry.timestamp
        })
    }
}

// Usage - just add the custom logger to the "list".
GGLog.add(new MyCustomLogger())
```
