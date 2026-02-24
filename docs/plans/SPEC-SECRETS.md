  class Secret {
    #value: string;  // private field

    constructor(value: string) {
      this.#value = value;
    }

    // Explicit method required to get value
    unwrap(): string {
      return this.#value;
    }

    // Prevent accidental logging
    toString(): string {
      return "[REDACTED]";
    }

    toJSON(): string {
      return "[REDACTED]";
    }

    // Node.js console.log uses this
    [Symbol.for("nodejs.util.inspect.custom")](): string {
      return "[REDACTED]";
    }
  }
