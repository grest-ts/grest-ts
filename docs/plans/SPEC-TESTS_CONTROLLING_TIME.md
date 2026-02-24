# Time Travel Testing - Proof of Concept

## Overview

This document describes a proof of concept for controlling time across a distributed system during testing:
- JavaScript main app (test runner) - runs in normal time
- JavaScript worker process - controlled time
- MySQL Docker container - controlled time
- Redis Docker container - controlled time

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ JS_MAIN_APP (Test Runner)                                   │
│ - Runs in NORMAL time                                       │
│ - Controls time for workers and containers                  │
│ - Orchestrates test scenarios                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ Controls via IPC/Redis
                           │
        ┌──────────────────┼──────────────────┬──────────────┐
        │                  │                  │              │
        ▼                  ▼                  ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ JS_WORKER    │  │ MySQL        │  │ Redis        │  │ Other        │
│              │  │ Container    │  │ Container    │  │ Workers      │
│ FAKE TIME    │  │ FAKE TIME    │  │ FAKE TIME    │  │ FAKE TIME    │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

## Components

### 1. Time Controller (Central Coordinator)

```javascript
class TimeController {
  constructor() {
    this.baseTime = new Date('2025-11-11 12:00:00');
    this.offset = 0; // milliseconds
    this.workers = [];
    this.containers = new Map(); // name -> container
  }

  // Register components
  registerWorker(worker) { }
  registerContainer(name, container) { }

  // Time manipulation
  advance(duration) { }
  setTime(date) { }
  now() { }

  // DB snapshot management
  createSnapshot(name) { }
  restoreSnapshot(name) { }
}
```

### 2. JS_MAIN_APP (Test Runner)

- Uses real system time
- Spawns worker processes
- Starts Docker containers with `--cap-add=SYS_TIME`
- Sends time control commands to workers and containers
- Runs test scenarios

### 3. JS_WORKER (Service Worker)

- Uses `@sinonjs/fake-timers` for time manipulation
- Listens for time control commands via IPC/Redis
- Updates its fake clock when commanded
- Uses `Date`, `setTimeout`, `setInterval` naturally

### 4. MySQL Container

- Started with `--cap-add=SYS_TIME` capability
- Time controlled via `docker exec <container> date -s "YYYY-MM-DD HH:MM:SS"`
- Supports `NOW()`, `CURRENT_TIMESTAMP` naturally
- Snapshot/restore via:
  - Create: `mysqldump` to file
  - Restore: `mysql < dump.sql`

### 5. Redis Container

- Started with `--cap-add=SYS_TIME` capability
- Time controlled via `docker exec <container> date -s "YYYY-MM-DD HH:MM:SS"`
- `TIME` command returns controlled time
- `EXPIRE` works with controlled time
- No snapshot needed (in-memory, fast to repopulate)

## Time Synchronization Protocol

### Advancing Time

```
1. Test Runner: runtime.time.advance("30s")
   │
   ├─→ 2. Calculate new offset: offset += 30000ms
   │
   ├─→ 3. For each worker:
   │      Send IPC: { type: 'TIME_ADVANCE', offset: 30000 }
   │      Worker receives → calls clock.tick(30000)
   │
   ├─→ 4. For each container:
   │      Calculate new date: baseTime + offset
   │      docker exec <id> date -s "2025-11-11 12:00:30"
   │
   └─→ 5. Wait for all components to acknowledge
```

### Setting Absolute Time

```
1. Test Runner: runtime.time.setTo("2025-12-25 00:00:00")
   │
   ├─→ 2. Calculate offset from base: target - Date.now()
   │
   ├─→ 3. For each worker:
   │      Send IPC: { type: 'TIME_SET', time: "2025-12-25 00:00:00" }
   │      Worker receives → calls clock.setSystemTime(time)
   │
   ├─→ 4. For each container:
   │      docker exec <id> date -s "2025-12-25 00:00:00"
   │
   └─→ 5. Wait for all components to acknowledge
```

## MySQL Snapshot Protocol

### Creating Snapshot

```bash
# 1. Create snapshot
docker exec mysql-container mysqldump \
  -u root -ppassword \
  --single-transaction \
  --quick \
  --lock-tables=false \
  test_db > /snapshots/baseline.sql

# Store metadata
{
  "name": "baseline",
  "created_at": "2025-11-11 12:00:00",
  "size_bytes": 1024000,
  "tables": ["users", "orders", "sessions"]
}
```

### Restoring Snapshot

```bash
# 1. Drop existing data
docker exec mysql-container mysql -u root -ppassword \
  -e "DROP DATABASE IF EXISTS test_db; CREATE DATABASE test_db;"

# 2. Restore from snapshot
docker exec -i mysql-container mysql -u root -ppassword test_db \
  < /snapshots/baseline.sql

# ~100ms for small DB, ~1s for medium DB
```

## Proof of Concept Structure

```
timetravel-poc/
├── README.md                 # Setup instructions
├── package.json              # Dependencies
├── src/
│   ├── main.js              # JS_MAIN_APP (test runner)
│   ├── worker.js            # JS_WORKER (service)
│   ├── timeController.js    # Time control logic
│   ├── containerManager.js  # Docker container management
│   └── snapshotManager.js   # MySQL snapshot management
├── test/
│   └── scenario.test.js     # Example test scenario
└── docker/
    └── docker-compose.yml   # MySQL + Redis setup
```

## Example Test Scenarios

### Scenario 1: Session Expiration

```javascript
test('session expires after 1 hour', async () => {
  // Worker creates session with 1 hour expiry
  const session = await worker.createSession(userId, 3600);
  // SQL: INSERT INTO sessions (expires_at) VALUES (NOW() + INTERVAL 3600 SECOND)

  // Verify session exists
  const exists = await mysql.query('SELECT * FROM sessions WHERE id = ?', [session.id]);
  expect(exists).toHaveLength(1);

  // Advance time by 61 minutes
  await timeControl.advance('61 minutes');

  // Worker checks session (should be expired)
  const isValid = await worker.validateSession(session.id);
  // SQL: SELECT * FROM sessions WHERE id = ? AND expires_at > NOW()
  // Returns nothing because NOW() is 61 minutes later!

  expect(isValid).toBe(false);
});
```

### Scenario 2: Redis Expiration

```javascript
test('redis key expires after 30 seconds', async () => {
  // Worker sets Redis key with 30s TTL
  await worker.cacheValue('test:key', 'test-data', 30);

  // Verify key exists
  const value1 = await redis.get('test:key');
  expect(value1).toBe('test-data');

  // Advance time by 31 seconds
  await timeControl.advance('31 seconds');

  // Key should be expired
  const value2 = await redis.get('test:key');
  expect(value2).toBeNull();
});
```

### Scenario 3: Worker setTimeout

```javascript
test('worker setTimeout fires after time advance', async () => {
  // Worker schedules task for 10 seconds
  const promise = worker.scheduleTask(10000, 'cleanup');

  // Task not completed yet
  expect(promise).not.toBeResolved();

  // Advance time by 11 seconds
  await timeControl.advance('11 seconds');

  // Task should have executed
  const result = await promise;
  expect(result).toBe('cleanup completed');
});
```

### Scenario 4: DB Snapshot Performance

```javascript
test('DB snapshot restore is fast', async () => {
  // Insert some data
  await mysql.query('INSERT INTO users (username, email) VALUES (?, ?)',
    ['alice', 'alice@example.com']);

  const users1 = await mysql.query('SELECT * FROM users');
  expect(users1).toHaveLength(1);

  // Restore snapshot
  const startTime = Date.now();
  await timeControl.mysql.restoreSnapshot('baseline');
  const duration = Date.now() - startTime;

  // Should be fast (< 1 second)
  expect(duration).toBeLessThan(1000);

  // Data should be reset
  const users2 = await mysql.query('SELECT * FROM users');
  expect(users2).toHaveLength(0);
});
```

### Scenario 5: Clock Synchronization

```javascript
test('all clocks stay synchronized', async () => {
  // Set specific time
  await timeControl.setTime('2025-12-25 00:00:00');

  // Check JS worker time
  const workerTime = await worker.getCurrentTime();
  expect(workerTime).toBe('2025-12-25 00:00:00');

  // Check MySQL time
  const [mysqlTime] = await mysql.query('SELECT NOW() as now');
  expect(mysqlTime.now).toEqual(new Date('2025-12-25 00:00:00'));

  // Check Redis time
  const redisTime = await redis.time();
  expect(redisTime).toEqual(new Date('2025-12-25 00:00:00'));

  // Advance all by 5 minutes
  await timeControl.advance('5 minutes');

  // All should be synchronized
  const workerTime2 = await worker.getCurrentTime();
  const [mysqlTime2] = await mysql.query('SELECT NOW() as now');
  const redisTime2 = await redis.time();

  const expected = new Date('2025-12-25 00:05:00');
  expect(workerTime2).toEqual(expected.toISOString());
  expect(mysqlTime2.now).toEqual(expected);
  expect(redisTime2).toEqual(expected);
});
```

## Implementation Approach

### Worker Time Control (fake-timers)

```javascript
// worker.js
import FakeTimers from '@sinonjs/fake-timers';

let clock = null;

process.on('message', (msg) => {
  if (msg.type === 'TIME_INIT') {
    clock = FakeTimers.install({
      now: new Date(msg.time),
      shouldAdvanceTime: false,
      toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout',
               'clearInterval', 'setImmediate', 'clearImmediate']
    });
  }

  if (msg.type === 'TIME_ADVANCE') {
    clock.tick(msg.ms);
    process.send({ type: 'TIME_ACK' });
  }

  if (msg.type === 'TIME_SET') {
    clock.setSystemTime(new Date(msg.time));
    process.send({ type: 'TIME_ACK' });
  }
});

// Now worker can use Date naturally:
function createSession(userId, expiresIn) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  // expiresAt uses fake time!
}
```

### Container Time Control

```javascript
// containerManager.js
export class ContainerManager {
  async setContainerTime(containerId, date) {
    const timeStr = this.formatDate(date);

    // Execute date command in container
    await exec(`docker exec ${containerId} date -s "${timeStr}"`);
  }

  formatDate(date) {
    // Format: "2025-11-11 12:00:00"
    return date.toISOString()
      .replace('T', ' ')
      .substring(0, 19);
  }
}
```

### MySQL Snapshot Manager

```javascript
// snapshotManager.js
export class MySQLSnapshotManager {
  constructor(containerId, config) {
    this.containerId = containerId;
    this.config = config;
    this.snapshotDir = './snapshots';
  }

  async createSnapshot(name) {
    const snapshotPath = `${this.snapshotDir}/${name}.sql`;

    // Create mysqldump
    await exec(`docker exec ${this.containerId} mysqldump \
      -u ${this.config.user} \
      -p${this.config.password} \
      --single-transaction \
      --quick \
      --lock-tables=false \
      ${this.config.database} > ${snapshotPath}`);

    return { name, path: snapshotPath };
  }

  async restoreSnapshot(name) {
    const snapshotPath = `${this.snapshotDir}/${name}.sql`;

    // Drop and recreate database
    await exec(`docker exec ${this.containerId} mysql \
      -u ${this.config.user} \
      -p${this.config.password} \
      -e "DROP DATABASE IF EXISTS ${this.config.database}; \
          CREATE DATABASE ${this.config.database};"`);

    // Restore from snapshot
    await exec(`docker exec -i ${this.containerId} mysql \
      -u ${this.config.user} \
      -p${this.config.password} \
      ${this.config.database} < ${snapshotPath}`);
  }
}
```

## Dependencies

```json
{
  "dependencies": {
    "@sinonjs/fake-timers": "^11.0.0",
    "testcontainers": "^10.0.0",
    "mysql2": "^3.0.0",
    "redis": "^4.6.0"
  }
}
```

## Success Criteria

The POC is successful if:

1. ✅ Worker process time can be controlled independently from main process
2. ✅ MySQL container time can be set and advanced
3. ✅ Redis container time can be set and advanced
4. ✅ All clocks stay synchronized when advancing time
5. ✅ `Date`, `setTimeout`, `NOW()`, `EXPIRE` all work naturally (no code changes)
6. ✅ MySQL snapshots can be created in < 1s
7. ✅ MySQL snapshots can be restored in < 1s
8. ✅ Works on Mac/Windows/Linux

## Limitations & Trade-offs

### Limitations
- Requires Docker with `--cap-add=SYS_TIME` (works on all platforms)
- Container time changes don't affect host system
- Slight overhead (~10-50ms) when advancing time across multiple containers
- Worker processes must use fake-timers (transparent to application code)

### Trade-offs
- **Complexity**: More complex than mocking time in code
- **Performance**: Slightly slower than no time control (~50ms overhead per advance)
- **Isolation**: Better isolation than shared test DB
- **Realism**: Tests use real `Date`, `NOW()`, etc. (more realistic)

## Next Steps

After POC validation:
1. Integrate into Grest framework as `runtime.time.*` API
2. Add automatic worker discovery and registration
3. Optimize snapshot creation (parallel dumps, compression)
4. Add support for PostgreSQL, MongoDB
5. Create developer-friendly error messages
6. Add time visualization/debugging tools
