import React, {useEffect, useRef, useState} from "react"
import {authApi, clearAuthToken, liveApi, setAuthToken, userApi} from "./api"
import type {User} from "../../auth/common/api/auth/UserAuth"
import type {LivePongEvent, ProfileUpdatedEvent} from "../../auth/common/api/LiveApi"
import type {GGWebSocketClient} from "@grest-ts/websocket"
import type {tUserAuthToken} from "../../auth/common/api/auth/UserAuth"

type View = "login" | "register"

const style = {
    container: {maxWidth: 560, margin: "40px auto", fontFamily: "monospace", padding: "0 16px"},
    card: {border: "1px solid #ccc", borderRadius: 4, padding: 20, marginBottom: 16},
    row: {display: "flex", gap: 8, marginBottom: 8},
    input: {flex: 1, padding: "6px 8px", fontFamily: "monospace", border: "1px solid #aaa", borderRadius: 2},
    btn: {padding: "6px 14px", fontFamily: "monospace", cursor: "pointer", border: "1px solid #666", borderRadius: 2, background: "#f5f5f5"},
    primary: {background: "#333", color: "#fff", border: "1px solid #333"},
    danger: {background: "#900", color: "#fff", border: "1px solid #900"},
    error: {color: "#c00", fontSize: 13, marginBottom: 8},
    success: {color: "#060", fontSize: 13, marginBottom: 8},
    label: {fontSize: 12, marginBottom: 4, display: "block", color: "#555"},
    section: {marginBottom: 12},
    log: {fontSize: 12, background: "#f9f9f9", border: "1px solid #eee", padding: 8, maxHeight: 120, overflowY: "auto" as const},
    tabs: {display: "flex", gap: 0, marginBottom: 16},
    tab: {padding: "6px 18px", cursor: "pointer", border: "1px solid #ccc", borderBottom: "none", background: "#f5f5f5"},
    activeTab: {background: "#fff", fontWeight: "bold"},
}

export function App() {
    const [user, setUser] = useState<User | null>(null)
    const [view, setView] = useState<View>("login")

    const [loginUsername, setLoginUsername] = useState("alice")
    const [loginPassword, setLoginPassword] = useState("secret123")

    const [regUsername, setRegUsername] = useState("")
    const [regEmail, setRegEmail] = useState("")
    const [regPassword, setRegPassword] = useState("")

    const [profileEmail, setProfileEmail] = useState("")
    const [msg, setMsg] = useState<{type: "ok" | "err"; text: string} | null>(null)

    const [wsConnected, setWsConnected] = useState(false)
    const [pongs, setPongs] = useState<LivePongEvent[]>([])
    const [profileEvents, setProfileEvents] = useState<ProfileUpdatedEvent[]>([])
    const wsRef = useRef<GGWebSocketClient<any, any> | null>(null)

    function flash(type: "ok" | "err", text: string) {
        setMsg({type, text})
        setTimeout(() => setMsg(null), 4000)
    }

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault()
        const res = await authApi.login({username: loginUsername, password: loginPassword}).asResult()
        if (!res.success) { flash("err", `Login failed: ${res.type}`); return }
        setAuthToken(res.data.token as tUserAuthToken)
        setUser(res.data.user)
        setProfileEmail(res.data.user.email)
        flash("ok", `Welcome back, ${res.data.user.username}!`)
    }

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await authApi.register({username: regUsername, email: regEmail as any, password: regPassword}).asResult()
        if (!res.success) { flash("err", `Registration failed: ${res.type}`); return }
        setAuthToken(res.data.token as tUserAuthToken)
        setUser(res.data.user)
        setProfileEmail(res.data.user.email)
        flash("ok", `Welcome, ${res.data.user.username}!`)
    }

    async function handleUpdateProfile(e: React.FormEvent) {
        e.preventDefault()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await userApi.updateProfile({email: profileEmail as any}).asResult()
        if (!res.success) { flash("err", `Update failed: ${res.type}`); return }
        setUser(res.data)
        flash("ok", "Profile updated")
    }

    function handleLogout() {
        clearAuthToken()
        setUser(null)
        wsRef.current?.disconnect()
        wsRef.current = null
        setWsConnected(false)
        setPongs([])
        setProfileEvents([])
        flash("ok", "Logged out")
    }

    async function handleConnectWs() {
        if (wsRef.current) return
        const client = liveApi
        wsRef.current = client
        try {
            await client.connect(({incoming}) => {
                setWsConnected(true)
                incoming.on({
                    pong: async (data) => { setPongs(prev => [...prev.slice(-9), data]) },
                    profileUpdated: async (data) => { setProfileEvents(prev => [...prev.slice(-9), data]) },
                })
            })
        } catch {
            flash("err", "WebSocket connection failed (auth required)")
            wsRef.current = null
        }
    }

    function handlePing() {
        wsRef.current?.outgoing.ping()
    }

    useEffect(() => {
        return () => { wsRef.current?.disconnect() }
    }, [])

    if (!user) {
        return (
            <div style={style.container}>
                <h2 style={{marginBottom: 20}}>grest-ts Auth Example</h2>
                <div style={style.tabs}>
                    {(["login", "register"] as View[]).map(v => (
                        <div key={v} style={{...style.tab, ...(view === v ? style.activeTab : {})}}
                            onClick={() => setView(v)}>
                            {v === "login" ? "Login" : "Register"}
                        </div>
                    ))}
                </div>
                {msg && <div style={msg.type === "ok" ? style.success : style.error}>{msg.text}</div>}

                {view === "login" ? (
                    <div style={style.card}>
                        <form onSubmit={handleLogin}>
                            <div style={style.section}>
                                <label style={style.label}>Username</label>
                                <div style={style.row}>
                                    <input style={style.input} value={loginUsername}
                                        onChange={e => setLoginUsername(e.target.value)} placeholder="alice" />
                                </div>
                            </div>
                            <div style={style.section}>
                                <label style={style.label}>Password</label>
                                <div style={style.row}>
                                    <input style={style.input} type="password" value={loginPassword}
                                        onChange={e => setLoginPassword(e.target.value)} placeholder="secret123" />
                                </div>
                            </div>
                            <button style={{...style.btn, ...style.primary}} type="submit">Login</button>
                        </form>
                    </div>
                ) : (
                    <div style={style.card}>
                        <form onSubmit={handleRegister}>
                            <div style={style.section}>
                                <label style={style.label}>Username (3-20 chars)</label>
                                <div style={style.row}>
                                    <input style={style.input} value={regUsername}
                                        onChange={e => setRegUsername(e.target.value)} placeholder="alice" />
                                </div>
                            </div>
                            <div style={style.section}>
                                <label style={style.label}>Email</label>
                                <div style={style.row}>
                                    <input style={style.input} type="email" value={regEmail}
                                        onChange={e => setRegEmail(e.target.value)} placeholder="alice@example.com" />
                                </div>
                            </div>
                            <div style={style.section}>
                                <label style={style.label}>Password</label>
                                <div style={style.row}>
                                    <input style={style.input} type="password" value={regPassword}
                                        onChange={e => setRegPassword(e.target.value)} placeholder="secret123" />
                                </div>
                            </div>
                            <button style={{...style.btn, ...style.primary}} type="submit">Register</button>
                        </form>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div style={style.container}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20}}>
                <h2 style={{margin: 0}}>grest-ts Auth Example</h2>
                <button style={{...style.btn, ...style.danger}} onClick={handleLogout}>Logout</button>
            </div>

            {msg && <div style={msg.type === "ok" ? style.success : style.error}>{msg.text}</div>}

            {/* Profile section */}
            <div style={style.card}>
                <h3 style={{marginTop: 0}}>Profile — {user.username}</h3>
                <div style={{marginBottom: 12, fontSize: 13, color: "#555"}}>
                    id: {user.id} &nbsp; email: {user.email}
                </div>
                <form onSubmit={handleUpdateProfile}>
                    <label style={style.label}>Update email</label>
                    <div style={style.row}>
                        <input style={style.input} type="email" value={profileEmail}
                            onChange={e => setProfileEmail(e.target.value)} />
                        <button style={{...style.btn, ...style.primary}} type="submit">Save</button>
                    </div>
                </form>
            </div>

            {/* WebSocket section */}
            <div style={style.card}>
                <h3 style={{marginTop: 0}}>
                    Live WebSocket {wsConnected
                        ? <span style={{color: "#060", fontSize: 12}}> ● connected</span>
                        : <span style={{color: "#999", fontSize: 12}}> ○ disconnected</span>}
                </h3>
                <div style={style.row}>
                    <button style={style.btn} onClick={handleConnectWs} disabled={wsConnected}>Connect</button>
                    <button style={style.btn} onClick={handlePing} disabled={!wsConnected}>Ping</button>
                </div>

                <label style={{...style.label, marginTop: 12}}>Pong responses</label>
                <div style={style.log}>
                    {pongs.length === 0
                        ? <span style={{color: "#aaa"}}>— press Ping after connecting —</span>
                        : pongs.map((p, i) => (
                            <div key={i}>pong from {p.username} @ {new Date(p.timestamp).toLocaleTimeString()}</div>
                        ))}
                </div>

                <label style={{...style.label, marginTop: 12}}>Profile update notifications</label>
                <div style={style.log}>
                    {profileEvents.length === 0
                        ? <span style={{color: "#aaa"}}>— save profile while connected to see events —</span>
                        : profileEvents.map((e, i) => (
                            <div key={i}>{e.username} email → {e.email}</div>
                        ))}
                </div>
            </div>
        </div>
    )
}
