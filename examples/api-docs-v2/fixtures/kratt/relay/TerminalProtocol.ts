// Client → Server (text frames)
export type ClientMessage =
    | { type: "resize"; cols: number; rows: number }
    | { type: "sendInput"; text: string }

// Server → Client (text frames)
export type ServerMessage =
    | { type: "status"; agentId: string; status: "running" | "stopped" }
    | { type: "error"; message: string }

// Binary frames (both directions): raw terminal data as Buffer
