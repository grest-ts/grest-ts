import React, {useEffect, useRef, useState} from "react"
import {authApi, clearAuthToken, createLiveClient, setAuthToken, userApi} from "./api"
import type {User} from "../../server/common/api/auth/UserAuth"
import type {GGWebSocketClient} from "@grest-ts/websocket"
import type {tUserAuthToken} from "../../server/common/api/auth/UserAuth"

// ─── types ───────────────────────────────────────────────────────────────────

type WsEntry = {time: string; event: string; data: unknown}
type ReqResult = {method: string; path: string; status: "ok" | "err"; body: unknown}

// ─── tiny helpers ─────────────────────────────────────────────────────────────

function now() {
    return new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"})
}

function Code({children}: {children: React.ReactNode}) {
    return (
        <pre style={{
            margin: 0, padding: "10px 12px", background: "#1e1e1e", color: "#d4d4d4",
            fontSize: 12, borderRadius: 4, overflowX: "auto", fontFamily: "monospace",
        }}>
            {children}
        </pre>
    )
}

function Badge({label, color}: {label: string; color: string}) {
    return (
        <span style={{
            fontSize: 10, fontWeight: "bold", padding: "2px 6px",
            borderRadius: 3, background: color, color: "#fff", marginRight: 6,
        }}>
            {label}
        </span>
    )
}

function Section({n, title, children}: {n: number; title: string; children: React.ReactNode}) {
    return (
        <div style={{marginBottom: 24}}>
            <div style={{display: "flex", alignItems: "center", gap: 10, marginBottom: 12}}>
                <span style={{
                    width: 24, height: 24, borderRadius: "50%", background: "#333", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: "bold", flexShrink: 0,
                }}>
                    {n}
                </span>
                <span style={{fontWeight: "bold", fontSize: 14}}>{title}</span>
            </div>
            <div style={{
                border: "1px solid #e0e0e0", borderRadius: 6, padding: 16,
                background: "#fafafa",
            }}>
                {children}
            </div>
        </div>
    )
}

const btn: React.CSSProperties = {
    padding: "6px 12px", fontSize: 12, fontFamily: "monospace",
    cursor: "pointer", border: "1px solid #bbb", borderRadius: 4,
    background: "#fff", whiteSpace: "nowrap",
}
const btnPrimary: React.CSSProperties = {...btn, background: "#2563eb", color: "#fff", border: "1px solid #2563eb"}
const btnDanger: React.CSSProperties = {...btn, background: "#dc2626", color: "#fff", border: "1px solid #dc2626"}
const btnWarning: React.CSSProperties = {...btn, background: "#d97706", color: "#fff", border: "1px solid #d97706"}
const btnGreen: React.CSSProperties = {...btn, background: "#16a34a", color: "#fff", border: "1px solid #16a34a"}
const input: React.CSSProperties = {
    padding: "6px 8px", fontSize: 12, fontFamily: "monospace",
    border: "1px solid #ccc", borderRadius: 4, background: "#fff",
}

// ─── app ──────────────────────────────────────────────────────────────────────

export function App() {
    // auth state
    const [user, setUser] = useState<User | null>(null)
    const [token, setToken] = useState<string | null>(null)
    const [authView, setAuthView] = useState<"login" | "register">("login")
    const [loginUser, setLoginUser] = useState("alice")
    const [loginPass, setLoginPass] = useState("secret123")
    const [regUser, setRegUser] = useState("")
    const [regEmail, setRegEmail] = useState("")
    const [regPass, setRegPass] = useState("")
    const [authError, setAuthError] = useState("")

    // request explorer state
    const [newEmail, setNewEmail] = useState("")
    const [lastReq, setLastReq] = useState<ReqResult | null>(null)

    // websocket state
    const [wsConnected, setWsConnected] = useState(false)
    const [wsLog, setWsLog] = useState<WsEntry[]>([])
    const wsRef = useRef<GGWebSocketClient<any, any> | null>(null)
    const wsLogRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        wsLogRef.current?.scrollTo(0, wsLogRef.current.scrollHeight)
    }, [wsLog])

    useEffect(() => () => { wsRef.current?.disconnect() }, [])

    function addWsEntry(event: string, data: unknown) {
        setWsLog(prev => [...prev.slice(-49), {time: now(), event, data}])
    }

    // ── auth handlers ──────────────────────────────────────────────────────────

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault()
        setAuthError("")
        const res = await authApi.login({username: loginUser, password: loginPass}).asResult()
        if (!res.success) { setAuthError(`${res.type}`); return }
        const t = res.data.token as tUserAuthToken
        setAuthToken(t)
        setToken(t)
        setUser(res.data.user)
        setNewEmail(res.data.user.email)
    }

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault()
        setAuthError("")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await authApi.register({username: regUser, email: regEmail as any, password: regPass}).asResult()
        if (!res.success) { setAuthError(`${res.type}`); return }
        const t = res.data.token as tUserAuthToken
        setAuthToken(t)
        setToken(t)
        setUser(res.data.user)
        setNewEmail(res.data.user.email)
    }

    function handleLogout() {
        clearAuthToken()
        setUser(null)
        setToken(null)
        setLastReq(null)
        wsRef.current?.disconnect()
        wsRef.current = null
        setWsConnected(false)
        setWsLog([])
    }

    // ── request handlers ───────────────────────────────────────────────────────

    async function callMe() {
        const res = await userApi.me().asResult()
        setLastReq({
            method: "GET", path: "/api/users/me",
            status: res.success ? "ok" : "err",
            body: res.success ? res.data : {error: res.type},
        })
    }

    async function callMeNoToken() {
        const saved = token as tUserAuthToken
        clearAuthToken()
        const res = await userApi.me().asResult()
        setAuthToken(saved)
        setLastReq({
            method: "GET", path: "/api/users/me  (no Authorization header)",
            status: "err",
            body: res.success ? res.data : {error: res.type, statusCode: 401},
        })
    }

    async function callUpdateProfile(e: React.FormEvent) {
        e.preventDefault()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await userApi.updateProfile({email: newEmail as any}).asResult()
        if (res.success) setUser(res.data)
        setLastReq({
            method: "PUT", path: "/api/users/profile",
            status: res.success ? "ok" : "err",
            body: res.success ? res.data : {error: res.type},
        })
    }

    // ── websocket handlers ─────────────────────────────────────────────────────

    async function connectWs() {
        if (wsRef.current) return
        const client = createLiveClient()
        wsRef.current = client
        try {
            await client.connect(({incoming}) => {
                setWsConnected(true)
                addWsEntry("connected", {info: "WebSocket handshake authenticated with Bearer token"})
                incoming.on({
                    pong: async (data) => addWsEntry("pong ←", data),
                    profileUpdated: async (data) => addWsEntry("profileUpdated ←", data),
                })
            })
        } catch {
            addWsEntry("error", {info: "Connection rejected — token missing or invalid"})
            wsRef.current = null
        }
    }

    function disconnectWs() {
        wsRef.current?.disconnect()
        wsRef.current = null
        setWsConnected(false)
        addWsEntry("disconnected", {})
    }

    function ping() {
        addWsEntry("ping →", {info: "sending ping to server..."})
        wsRef.current?.outgoing.ping()
    }

    // ── render: anonymous ──────────────────────────────────────────────────────

    if (!user) {
        return (
            <div style={{maxWidth: 480, margin: "48px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif"}}>
                <h2 style={{fontSize: 20, marginBottom: 4}}>grest-ts auth demo</h2>
                <p style={{fontSize: 13, color: "#666", marginBottom: 24}}>
                    Register or login to explore HTTP auth and live WebSocket events.
                </p>

                <div style={{display: "flex", gap: 0, marginBottom: 0}}>
                    {(["login", "register"] as const).map(v => (
                        <button key={v} onClick={() => { setAuthView(v); setAuthError("") }}
                            style={{
                                ...btn, borderRadius: "4px 4px 0 0",
                                borderBottom: authView === v ? "1px solid #fafafa" : "1px solid #e0e0e0",
                                background: authView === v ? "#fafafa" : "#f0f0f0",
                                fontWeight: authView === v ? "bold" : "normal",
                            }}>
                            {v}
                        </button>
                    ))}
                </div>
                <div style={{border: "1px solid #e0e0e0", borderRadius: "0 4px 4px 4px", padding: 20, background: "#fafafa"}}>
                    {authView === "login" ? (
                        <form onSubmit={handleLogin} style={{display: "flex", flexDirection: "column", gap: 10}}>
                            <input style={{...input, width: "100%", boxSizing: "border-box"}}
                                placeholder="username" value={loginUser} onChange={e => setLoginUser(e.target.value)} />
                            <input style={{...input, width: "100%", boxSizing: "border-box"}}
                                type="password" placeholder="password" value={loginPass}
                                onChange={e => setLoginPass(e.target.value)} />
                            {authError && <div style={{color: "#dc2626", fontSize: 12}}>{authError}</div>}
                            <button style={btnPrimary} type="submit">Login →</button>
                            <div style={{fontSize: 11, color: "#888"}}>
                                No account? Try: register as "alice" / "alice@example.com" / "secret123"
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleRegister} style={{display: "flex", flexDirection: "column", gap: 10}}>
                            <input style={{...input, width: "100%", boxSizing: "border-box"}}
                                placeholder="username (3–20 chars)" value={regUser}
                                onChange={e => setRegUser(e.target.value)} />
                            <input style={{...input, width: "100%", boxSizing: "border-box"}}
                                type="email" placeholder="email" value={regEmail}
                                onChange={e => setRegEmail(e.target.value)} />
                            <input style={{...input, width: "100%", boxSizing: "border-box"}}
                                type="password" placeholder="password" value={regPass}
                                onChange={e => setRegPass(e.target.value)} />
                            {authError && <div style={{color: "#dc2626", fontSize: 12}}>{authError}</div>}
                            <button style={btnPrimary} type="submit">Register →</button>
                        </form>
                    )}
                </div>
            </div>
        )
    }

    // ── render: authenticated ──────────────────────────────────────────────────

    return (
        <div style={{maxWidth: 600, margin: "32px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif"}}>
            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24}}>
                <h2 style={{margin: 0, fontSize: 18}}>grest-ts auth demo</h2>
                <button style={btnDanger} onClick={handleLogout}>Logout</button>
            </div>

            {/* ── 1. Session ── */}
            <Section n={1} title="Active session">
                <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 10}}>
                    <span style={{
                        width: 8, height: 8, borderRadius: "50%", background: "#16a34a",
                        display: "inline-block", flexShrink: 0,
                    }} />
                    <span style={{fontSize: 13}}>
                        Signed in as <strong>{user.username}</strong> &nbsp;
                        <span style={{color: "#888"}}>{user.email}</span>
                    </span>
                </div>
                <div style={{fontSize: 11, color: "#888", marginBottom: 6}}>Bearer token (sent in Authorization header on every protected request)</div>
                <Code>{token}</Code>
            </Section>

            {/* ── 2. HTTP requests ── */}
            <Section n={2} title="HTTP requests">
                <div style={{display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16}}>
                    <button style={btnGreen} onClick={callMe}>
                        <Badge label="GET" color="#16a34a" />
                        /api/users/me
                    </button>
                    <button style={btnWarning} onClick={callMeNoToken}>
                        <Badge label="GET" color="#d97706" />
                        /api/users/me  — no token
                    </button>
                </div>

                <form onSubmit={callUpdateProfile}
                    style={{display: "flex", gap: 8, alignItems: "center", marginBottom: 16}}>
                    <Badge label="PUT" color="#7c3aed" />
                    <span style={{fontSize: 12, color: "#555", whiteSpace: "nowrap"}}>/api/users/profile</span>
                    <input style={{...input, flex: 1}} type="email" placeholder="new email"
                        value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                    <button style={{...btn, background: "#7c3aed", color: "#fff", border: "1px solid #7c3aed"}}
                        type="submit">
                        Save
                    </button>
                </form>

                {lastReq ? (
                    <div>
                        <div style={{
                            fontSize: 11, marginBottom: 6, display: "flex", alignItems: "center", gap: 6,
                        }}>
                            <Badge label={lastReq.method} color={lastReq.method === "GET" ? "#1d4ed8" : "#7c3aed"} />
                            <code style={{fontSize: 11}}>{lastReq.path}</code>
                            <span style={{
                                marginLeft: "auto", fontSize: 11, fontWeight: "bold",
                                color: lastReq.status === "ok" ? "#16a34a" : "#dc2626",
                            }}>
                                {lastReq.status === "ok" ? "200 OK" : "401 NOT_AUTHORIZED"}
                            </span>
                        </div>
                        <Code>{JSON.stringify(lastReq.body, null, 2)}</Code>
                    </div>
                ) : (
                    <div style={{fontSize: 12, color: "#aaa"}}>— click a request button to see the response —</div>
                )}
            </Section>

            {/* ── 3. WebSocket ── */}
            <Section n={3} title={
                `WebSocket  ws/live  — same token, real-time events` +
                (wsConnected ? "  ●" : "  ○")
            }>
                <div style={{display: "flex", gap: 8, marginBottom: 12, alignItems: "center"}}>
                    {!wsConnected ? (
                        <button style={btnPrimary} onClick={connectWs}>Connect</button>
                    ) : (
                        <>
                            <button style={btnDanger} onClick={disconnectWs}>Disconnect</button>
                            <button style={btn} onClick={ping}>Ping →</button>
                        </>
                    )}
                    <span style={{fontSize: 11, color: "#888"}}>
                        {wsConnected
                            ? "Token was verified during WS handshake. Try Save on profile — watch the event appear here."
                            : "Connect to open an authenticated WS channel on the same token."}
                    </span>
                </div>

                <div ref={wsLogRef} style={{
                    height: 180, overflowY: "auto",
                    background: "#1e1e1e", borderRadius: 4, padding: "8px 10px",
                    fontSize: 12, fontFamily: "monospace",
                }}>
                    {wsLog.length === 0 ? (
                        <span style={{color: "#555"}}>— no events yet —</span>
                    ) : (
                        wsLog.map((e, i) => (
                            <div key={i} style={{marginBottom: 3, display: "flex", gap: 10}}>
                                <span style={{color: "#6b7280", flexShrink: 0}}>{e.time}</span>
                                <span style={{
                                    color: e.event.includes("←") ? "#86efac"
                                        : e.event.includes("→") ? "#93c5fd"
                                        : e.event === "connected" ? "#4ade80"
                                        : e.event === "error" ? "#f87171"
                                        : "#e5e7eb",
                                    flexShrink: 0,
                                }}>
                                    {e.event}
                                </span>
                                <span style={{color: "#d1d5db", wordBreak: "break-all"}}>
                                    {JSON.stringify(e.data)}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </Section>
        </div>
    )
}
