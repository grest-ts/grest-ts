import { Routes, Route, Link } from 'react-router-dom'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ChecklistPage } from './pages/ChecklistPage'
import { SettingsPage } from './pages/SettingsPage'
import { useAuth } from './hooks/useAuth'

export function App() {
  const { user, logout } = useAuth()

  return (
    <div>
      <nav style={{ marginBottom: '2rem', borderBottom: '1px solid #ccc', paddingBottom: '1rem' }}>
        <h1>Checklist App</h1>
        {user ? (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.5rem' }}>
            <span>Welcome, {user.username}</span>
            <Link to="/checklist">Checklist</Link>
            <Link to="/settings">Settings</Link>
            <button onClick={logout}>Logout</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
          </div>
        )}
      </nav>

      <Routes>
        <Route path="/" element={<div>Welcome! Please login or register to continue.</div>} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/checklist" element={<ChecklistPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  )
}
