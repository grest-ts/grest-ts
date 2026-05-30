import React, {useEffect, useRef, useState} from "react"
import {api, session} from "./api"
import type {User} from "../../api/auth/UserAuth"
import type {Org} from "../../api/auth/OrgAuth"
import type {AuthResponse} from "../../api/AuthPublicApi"
import type {GGWebSocketClient} from "@grest-ts/websocket"
import type {BannerPongEvent, LivePongEvent, ProfileUpdatedEvent} from "../../api/LiveApi"

// ─── tiny helpers ─────────────────────────────────────────────────────────────

type WsEntry = { time: string; event: string; data: unknown }
type ReqResult = { method: string; path: string; status: "ok" | "err"; body: unknown }

function now() {
    return new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"})
}

function Code({children}: { children: React.ReactNode }) {
    return (
        <pre style={{margin: 0, padding: "10px 12px", background: "#1e1e1e", color: "#d4d4d4", fontSize: 12, borderRadius: 4, overflowX: "auto", fontFamily: "monospace"}}>
            {children}
        </pre>
    )
}

function Badge({label, color}: { label: string; color: string }) {
    return <span style={{fontSize: 10, fontWeight: "bold", padding: "2px 6px", borderRadius: 3, background: color, color: "#fff", marginRight: 6}}>{label}</span>
}

function Section({n, title, children}: { n: number; title: string; children: React.ReactNode }) {
    return (
        <div style={{marginBottom: 20}}>
            <div style={{display: "flex", alignItems: "center", gap: 10, marginBottom: 10}}>
                <span style={{width: 22, height: 22, borderRadius: "50%", background: "#333", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: "bold", flexShrink: 0}}>{n}</span>
                <span style={{fontWeight: "bold", fontSize: 13}}>{title}</span>
            </div>
            <div style={{border: "1px solid #e0e0e0", borderRadius: 6, padding: 14, background: "#fafafa"}}>{children}</div>
        </div>
    )
}

const btn: React.CSSProperties = {padding: "6px 12px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", border: "1px solid #bbb", borderRadius: 4, background: "#fff", whiteSpace: "nowrap"}
const btnPrimary: React.CSSProperties = {...btn, background: "#2563eb", color: "#fff", border: "1px solid #2563eb"}
const btnDanger: React.CSSProperties = {...btn, background: "#dc2626", color: "#fff", border: "1px solid #dc2626"}
const btnWarning: React.CSSProperties = {...btn, background: "#d97706", color: "#fff", border: "1px solid #d97706"}
const btnGreen: React.CSSProperties = {...btn, background: "#16a34a", color: "#fff", border: "1px solid #16a34a"}
const btnPurple: React.CSSProperties = {...btn, background: "#7c3aed", color: "#fff", border: "1px solid #7c3aed"}
const input: React.CSSProperties = {padding: "6px 8px", fontSize: 12, fontFamily: "monospace", border: "1px solid #ccc", borderRadius: 4, background: "#fff"}

// ─── app ──────────────────────────────────────────────────────────────────────

export function App() {
    const [user, setUser] = useState<User | null>(null)
    const [permissions, setPerms] = useState<string[]>([])

    const [authView, setAuthView] = useState<"login" | "register">("login")
    const [loginUser, setLoginUser] = useState("alice")
    const [loginPass, setLoginPass] = useState("secret123")
    const [regUser, setRegUser] = useState("")
    const [regEmail, setRegEmail] = useState("")
    const [regPass, setRegPass] = useState("")
    const [authError, setAuthError] = useState("")

    const [newEmail, setNewEmail] = useState("")
    const [lastReq, setLastReq] = useState<ReqResult | null>(null)

    const [orgList, setOrgList] = useState<Org[]>([])
    const [bannerCount, setBannerCount] = useState(0)

    const [wsConnected, setWsConnected] = useState(false)
    const [wsLog, setWsLog] = useState<WsEntry[]>([])
    const wsRef = useRef<GGWebSocketClient<any, any> | null>(null)
    const wsLogRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        wsLogRef.current?.scrollTo(0, wsLogRef.current.scrollHeight)
    }, [wsLog])
    useEffect(() => () => {
        wsRef.current?.disconnect()
    }, [])

    // Clear all local state when the session ends (logout, expiry, cross-tab logout).
    useEffect(() => session.onLogout(() => {
        setUser(null);
        setPerms([]);
        setOrgList([]);
        setBannerCount(0)
        wsRef.current?.disconnect();
        wsRef.current = null
        setWsConnected(false);
        setWsLog([])
    }), [])

    function addWsEntry(event: string, data: unknown) {
        setWsLog(prev => [...prev.slice(-49), {time: now(), event, data}])
    }

    // ── auth helpers ───────────────────────────────────────────────────────────

    function applyAuthResult(res: AuthResponse) {
        session.start(res)
        setUser(res.user)
        setPerms(parseJwtPermissions(res.access.token))
        setNewEmail(res.user.email)
    }

    async function quickStart(username: string) {
        setAuthError("")
        const email = `${username}@example.com`
        const password = "secret123"
        const reg = await api.authApi.register({username, email: email as any, password}).asResult()
        if (reg.success) {
            applyAuthResult(reg.data);
            return
        }
        if (reg.type === "EXISTS") {
            const log = await api.authApi.login({username, password}).asResult()
            if (log.success) {
                applyAuthResult(log.data);
                return
            }
            setAuthError(`${log.type}`)
            return
        }
        setAuthError(`${reg.type}`)
    }

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        setAuthError("")
        const res = await api.authApi.login({username: loginUser, password: loginPass}).asResult()
        if (!res.success) {
            setAuthError(res.type);
            return
        }
        applyAuthResult(res.data)
    }

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        setAuthError("")
        const res = await api.authApi.register({username: regUser, email: regEmail as any, password: regPass}).asResult()
        if (!res.success) {
            setAuthError(res.type);
            return
        }
        applyAuthResult(res.data)
    }

    function handleLogout() {
        session.logout()
        // onLogout listener handles state cleanup
    }

    // ── org helpers ────────────────────────────────────────────────────────────

    async function loadOrgs() {
        const res = await api.orgApi.listOrgs().asResult()
        if (res.success) setOrgList(res.data)
    }

    async function selectOrg(org: Org) {
        await session.derived.org.select({orgId: org.id})
    }

    function deselectOrg() {
        session.derived.org.clear()
    }

    // ── HTTP request helpers ───────────────────────────────────────────────────

    async function callMe() {
        const res = await api.userApi.me().asResult()
        setLastReq({
            method: "GET", path: "/api/users/me", status: res.success ? "ok" : "err",
            body: res.success ? res.data : {error: res.type}
        })
    }

    async function callOrgInfo() {
        const res = await api.orgApi.orgInfo().asResult()
        setLastReq({
            method: "GET", path: "/api/orgs/info", status: res.success ? "ok" : "err",
            body: res.success ? res.data : {error: res.type}
        })
    }

    async function callUpdateProfile(e: React.FormEvent) {
        e.preventDefault()
        const res = await api.userApi.updateProfile({email: newEmail as any}).asResult()
        if (res.success) setUser(res.data)
        setLastReq({
            method: "PUT", path: "/api/users/profile", status: res.success ? "ok" : "err",
            body: res.success ? res.data : {error: res.type}
        })
    }

    async function callClickBanner() {
        const res = await api.bannerApi.clickBanner().asResult()
        if (res.success) setBannerCount(res.data.count)
        setLastReq({
            method: "POST", path: "/api/banner/click", status: res.success ? "ok" : "err",
            body: res.success ? res.data : {error: res.type}
        })
    }

    // ── websocket helpers ──────────────────────────────────────────────────────

    async function connectWs() {
        if (wsRef.current) return
        const client = api.createLiveClient()
        wsRef.current = client
        try {
            await client.connect(({incoming}) => {
                setWsConnected(true)
                addWsEntry("connected", {info: "Handshake authenticated"})
                incoming.on({
                    pong: async (d: LivePongEvent) => addWsEntry("pong ←", d),
                    profileUpdated: async (d: ProfileUpdatedEvent) => addWsEntry("profileUpdated ←", d),
                    bannerPong: async (d: BannerPongEvent) => {
                        setBannerCount(d.count)
                        addWsEntry("bannerPong ←", d)
                    },
                })
            })
        } catch {
            addWsEntry("error", {info: "Connection rejected"})
            wsRef.current = null
        }
    }

    function disconnectWs() {
        wsRef.current?.disconnect();
        wsRef.current = null
        setWsConnected(false);
        addWsEntry("disconnected", {})
    }

    function ping() {
        addWsEntry("ping →", {});
        wsRef.current?.outgoing.ping()
    }

    function bannerPingWs() {
        addWsEntry("bannerPing →", {info: "sending bannerPing (requires CAN_SEE_RED_BANNER)..."})
        wsRef.current?.outgoing.bannerPing()
    }

    const hasBannerPerm = permissions.includes("CAN_UPDATE_RED_BANNER_COUNTER")

    // ── anonymous view ─────────────────────────────────────────────────────────

    if (!user) {
        return (
            <div style={{maxWidth: 460, margin: "48px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif"}}>
                <h2 style={{fontSize: 20, marginBottom: 4}}>grest-ts auth demo</h2>
                <p style={{fontSize: 13, color: "#666", marginBottom: 20}}>
                    Explore JWT auth, permissions, org selector, and live WebSocket events.
                </p>

                <div style={{border: "1px solid #e0e0e0", borderRadius: 6, padding: 14, background: "#fafafa", marginBottom: 16}}>
                    <div style={{fontSize: 11, color: "#888", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1}}>
                        Quick start — one click
                    </div>
                    <div style={{display: "flex", gap: 8, marginBottom: 8}}>
                        {["alice", "bob", "carol"].map(name => (
                            <button key={name} onClick={() => quickStart(name)} style={{...btnPrimary, fontSize: 13, padding: "8px 18px"}}>
                                {name}
                            </button>
                        ))}
                    </div>
                    <div style={{fontSize: 11, color: "#aaa"}}>
                        alice + carol get <strong>CAN_UPDATE_RED_BANNER_COUNTER</strong> · bob doesn't · password: secret123
                    </div>
                    {authError && <div style={{color: "#dc2626", fontSize: 12, marginTop: 8}}>{authError}</div>}
                </div>

                <div style={{display: "flex", gap: 0, marginBottom: 0}}>
                    {(["login", "register"] as const).map(v => (
                        <button key={v} onClick={() => {
                            setAuthView(v);
                            setAuthError("")
                        }}
                                style={{...btn, borderRadius: "4px 4px 0 0", borderBottom: authView === v ? "1px solid #fafafa" : "1px solid #e0e0e0", background: authView === v ? "#fafafa" : "#f0f0f0", fontWeight: authView === v ? "bold" : "normal", color: "#888", fontSize: 11}}>
                            {v} manually
                        </button>
                    ))}
                </div>
                <div style={{border: "1px solid #e0e0e0", borderRadius: "0 4px 4px 4px", padding: 14, background: "#fafafa"}}>
                    {authView === "login" ? (
                        <form onSubmit={handleLogin} style={{display: "flex", flexDirection: "column", gap: 8}}>
                            <input style={{...input, width: "100%", boxSizing: "border-box"}} placeholder="username" value={loginUser} onChange={e => setLoginUser(e.target.value)}/>
                            <input style={{...input, width: "100%", boxSizing: "border-box"}} type="password" placeholder="password" value={loginPass} onChange={e => setLoginPass(e.target.value)}/>
                            {authError && <div style={{color: "#dc2626", fontSize: 12}}>{authError}</div>}
                            <button style={btnPrimary} type="submit">Login →</button>
                        </form>
                    ) : (
                        <form onSubmit={handleRegister} style={{display: "flex", flexDirection: "column", gap: 8}}>
                            <input style={{...input, width: "100%", boxSizing: "border-box"}} placeholder="username (3–20 chars)" value={regUser} onChange={e => setRegUser(e.target.value)}/>
                            <input style={{...input, width: "100%", boxSizing: "border-box"}} type="email" placeholder="email" value={regEmail} onChange={e => setRegEmail(e.target.value)}/>
                            <input style={{...input, width: "100%", boxSizing: "border-box"}} type="password" placeholder="password" value={regPass} onChange={e => setRegPass(e.target.value)}/>
                            {authError && <div style={{color: "#dc2626", fontSize: 12}}>{authError}</div>}
                            <button style={btnPrimary} type="submit">Register →</button>
                        </form>
                    )}
                </div>
            </div>
        )
    }

    // ── authenticated view ─────────────────────────────────────────────────────

    return (
        <div style={{maxWidth: 620, margin: "28px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif"}}>
            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20}}>
                <h2 style={{margin: 0, fontSize: 17}}>grest-ts auth demo</h2>
                <button style={btnDanger} onClick={handleLogout}>Logout</button>
            </div>

            {/* 1 — Session */}
            <Section n={1} title="Active session">
                <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 8}}>
                    <span style={{width: 7, height: 7, borderRadius: "50%", background: "#16a34a", display: "inline-block"}}/>
                    <span style={{fontSize: 13}}><strong>{user.username}</strong> &nbsp;<span style={{color: "#888"}}>{user.email}</span></span>
                </div>
                <div style={{fontSize: 11, color: "#888", marginBottom: 4}}>
                    Permissions in JWT: {permissions.length === 0 ? <em style={{color: "#aaa"}}>none</em> : permissions.map(p => (
                    <span key={p} style={{background: "#16a34a", color: "#fff", fontSize: 10, padding: "1px 6px", borderRadius: 3, marginRight: 4}}>{p}</span>
                ))}
                </div>
            </Section>

            {/* 2 — Org selector */}
            <Section n={2} title="Organization selector (derived token)">
                {session.derived.org.get() ? (
                    <div>
                        <div style={{display: "flex", alignItems: "center", gap: 10, marginBottom: 10}}>
                            <span style={{width: 7, height: 7, borderRadius: "50%", background: "#7c3aed", display: "inline-block"}}/>
                            <strong style={{fontSize: 13}}>{session.derived.org.get().name}</strong>
                            <span style={{fontSize: 11, color: "#888"}}>{session.derived.org.description}</span>
                            <button style={{...btn, fontSize: 11}} onClick={deselectOrg}>Deselect</button>
                        </div>
                        <button style={btnPurple} onClick={callOrgInfo} type="button">
                            <Badge label="GET" color="#7c3aed"/>/api/orgs/info
                        </button>
                        <span style={{fontSize: 11, color: "#888", marginLeft: 8}}>requires ORG_MEMBER in org token</span>
                    </div>
                ) : (
                    <div>
                        <div style={{fontSize: 12, color: "#666", marginBottom: 10}}>
                            Select an org to get a scoped org token. The <code>orgInfo</code> endpoint requires <strong>ORG_MEMBER</strong> from the org JWT — otherwise FORBIDDEN.
                        </div>
                        <div style={{display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8}}>
                            {orgList.length === 0 ? (
                                <button style={btn} onClick={loadOrgs}>Load my orgs</button>
                            ) : (
                                orgList.map(org => (
                                    <button key={org.id} style={btnPurple} onClick={() => selectOrg(org)}>
                                        {org.name}
                                    </button>
                                ))
                            )}
                        </div>
                        {orgList.length > 0 && (
                            <div style={{fontSize: 11, color: "#888"}}>
                                Click an org to receive an org-scoped JWT (x-org-token header) via AuthSession derived token pool
                            </div>
                        )}
                    </div>
                )}
            </Section>

            {/* 3 — Red banner */}
            <Section n={3} title="Red banner — permission gate: CAN_UPDATE_RED_BANNER_COUNTER">
                <div style={{
                    background: "#fecaca", border: "2px solid #ef4444", borderRadius: 6,
                    padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12,
                }}>
                    <span style={{fontSize: 22}}>🔴</span>
                    <div style={{flex: 1}}>
                        <div style={{fontWeight: "bold", fontSize: 13}}>Red Banner</div>
                        <div style={{fontSize: 12, color: "#666"}}>
                            {hasBannerPerm
                                ? "You have CAN_UPDATE_RED_BANNER_COUNTER — clicking is allowed"
                                : "You don't have CAN_UPDATE_RED_BANNER_COUNTER — clicking will return FORBIDDEN"}
                        </div>
                    </div>
                    <div style={{textAlign: "right"}}>
                        <div style={{fontSize: 22, fontWeight: "bold", color: "#dc2626"}}>{bannerCount}</div>
                        <div style={{fontSize: 10, color: "#888"}}>clicks</div>
                    </div>
                </div>
                <div style={{display: "flex", gap: 8}}>
                    <button style={hasBannerPerm ? btnGreen : btnWarning} onClick={callClickBanner}>
                        <Badge label="POST" color={hasBannerPerm ? "#16a34a" : "#d97706"}/>
                        /api/banner/click
                    </button>
                </div>
            </Section>

            {/* 4 — HTTP requests */}
            <Section n={4} title="HTTP requests">
                <div style={{display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12}}>
                    <button style={btnGreen} onClick={callMe}>
                        <Badge label="GET" color="#16a34a"/>/api/users/me
                    </button>
                </div>
                <form onSubmit={callUpdateProfile} style={{display: "flex", gap: 8, alignItems: "center", marginBottom: 12}}>
                    <Badge label="PUT" color="#7c3aed"/>
                    <span style={{fontSize: 12, color: "#555", whiteSpace: "nowrap"}}>/api/users/profile</span>
                    <input style={{...input, flex: 1}} type="email" placeholder="new email" value={newEmail} onChange={e => setNewEmail(e.target.value)}/>
                    <button style={{...btn, background: "#7c3aed", color: "#fff", border: "1px solid #7c3aed"}} type="submit">Save</button>
                </form>
                {lastReq ? (
                    <div>
                        <div style={{fontSize: 11, marginBottom: 6, display: "flex", alignItems: "center", gap: 6}}>
                            <Badge label={lastReq.method} color={lastReq.status === "ok" ? "#1d4ed8" : "#dc2626"}/>
                            <code style={{fontSize: 11}}>{lastReq.path}</code>
                            <span style={{marginLeft: "auto", fontSize: 11, fontWeight: "bold", color: lastReq.status === "ok" ? "#16a34a" : "#dc2626"}}>
                                {lastReq.status === "ok" ? "200 OK" : "401/403"}
                            </span>
                        </div>
                        <Code>{JSON.stringify(lastReq.body, null, 2)}</Code>
                    </div>
                ) : (
                    <div style={{fontSize: 12, color: "#aaa"}}>— click a request button to see the response —</div>
                )}
            </Section>

            {/* 5 — WebSocket */}
            <Section n={5} title={`WebSocket ws/live  —  same token, permission-gated messages  ${wsConnected ? "●" : "○"}`}>
                <div style={{display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap"}}>
                    {!wsConnected ? (
                        <button style={btnPrimary} onClick={connectWs}>Connect</button>
                    ) : (
                        <>
                            <button style={btnDanger} onClick={disconnectWs}>Disconnect</button>
                            <button style={btn} onClick={ping}>Ping →</button>
                            <button style={hasBannerPerm ? btnGreen : btnWarning} onClick={bannerPingWs}>
                                bannerPing → {hasBannerPerm ? "" : "(→ FORBIDDEN)"}
                            </button>
                        </>
                    )}
                    <span style={{fontSize: 11, color: "#888"}}>
                        {wsConnected ? "bannerPing requires CAN_UPDATE_RED_BANNER_COUNTER — gated by the framework, not app code" : "Connect with user JWT via Authorization header"}
                    </span>
                </div>
                <div ref={wsLogRef} style={{height: 180, overflowY: "auto", background: "#1e1e1e", borderRadius: 4, padding: "8px 10px", fontSize: 12, fontFamily: "monospace"}}>
                    {wsLog.length === 0 ? (
                        <span style={{color: "#555"}}>— no events yet —</span>
                    ) : (
                        wsLog.map((e, i) => (
                            <div key={i} style={{marginBottom: 3, display: "flex", gap: 10}}>
                                <span style={{color: "#6b7280", flexShrink: 0}}>{e.time}</span>
                                <span style={{color: e.event.includes("←") ? "#86efac" : e.event.includes("→") ? "#93c5fd" : e.event === "connected" ? "#4ade80" : e.event === "error" ? "#f87171" : "#e5e7eb", flexShrink: 0}}>
                                    {e.event}
                                </span>
                                <span style={{color: "#d1d5db", wordBreak: "break-all"}}>{JSON.stringify(e.data)}</span>
                            </div>
                        ))
                    )}
                </div>
            </Section>
        </div>
    )
}

// ── helpers ────────────────────────────────────────────────────────────────────

function parseJwtPermissions(token: string): string[] {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]))
        return Array.isArray(payload.permissions) ? payload.permissions : []
    } catch {
        return []
    }
}
