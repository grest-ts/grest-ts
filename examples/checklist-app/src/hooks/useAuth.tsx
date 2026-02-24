import { createContext, useContext, useState, ReactNode, useEffect } from 'react'
import { sdk } from '../lib/sdk'
import { useNotification } from './useNotification'
import {UserAppSDKAuthenticated} from "../UserAppSDK/UserAppSDK.gen.ts";
import {tUserAuthToken, User} from "../UserAppSDK/shared/shared-types.gen.ts";
import {UserAuthState} from "../UserAppSDK/auth/UserAuthState.gen.ts";

interface AuthContextType {
  user: User | null
  token: string | null
  authenticatedSDK: UserAppSDKAuthenticated | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [authenticatedSDK, setAuthenticatedSDK] = useState<UserAppSDKAuthenticated | null>(null)
  const { showError, showSuccess, showInfo } = useNotification()

  useEffect(() => {
    // Load auth from localStorage on mount
    const savedToken = localStorage.getItem('authToken')
    const savedUser = localStorage.getItem('authUser')
    if (savedToken && savedUser) {
      try {
        const user = JSON.parse(savedUser)
        setToken(savedToken)
        setUser(user)

        // Restore the authenticated SDK from stored credentials
        const auth = new UserAuthState()
        auth.setLoggedIn({ token: savedToken as tUserAuthToken, user })

        const restoredSDK = new UserAppSDKAuthenticated(auth, {
          url: import.meta.env.VITE_API_URL || 'http://localhost:9000'
        })

        setAuthenticatedSDK(restoredSDK)
      } catch (error) {
        console.error('Failed to restore session:', error)
        // Clear invalid stored data
        localStorage.removeItem('authToken')
        localStorage.removeItem('authUser')
      }
    }
  }, [])

  const login = async (username: string, password: string) => {
    try {
      const result = await sdk.login({ username, password })

      if (result.success === false) {
        const errorMessage = result.type === 'INVALID_CREDENTIALS'
          ? 'Invalid username or password'
          : 'Login failed. Please try again.'

        showError(errorMessage)
        throw new Error('Login failed')
      }

      setUser(result.data.user)
      setToken(result.data.token)
      setAuthenticatedSDK(result.data.sdk)

      // Persist to localStorage
      localStorage.setItem('authToken', result.data.token)
      localStorage.setItem('authUser', JSON.stringify(result.data.user))

      showSuccess(`Welcome back, ${result.data.user.username}!`)
    } catch (error) {
      // Catch network errors and other unexpected errors
      if (error instanceof Error && error.message !== 'Login failed') {
        showError(`Network error: ${error.message}`)
      }
      throw error
    }
  }

  const register = async (username: string, email: string, password: string) => {
    try {
      const result = await sdk.register({ username, email, password })

      if (result.success === false) {
        let errorMessage = 'Registration failed. Please try again.'
        if (result.type === 'EXISTS') {
          errorMessage = 'Username or email already exists'
        } else if (result.type === 'BAD_USERNAME') {
          errorMessage = result.data.reason
        } else if (result.type === 'VALIDATION_ERROR') {
          errorMessage = 'Please check your input'
        }

        showError(errorMessage)
        throw new Error('Registration failed')
      }

      setUser(result.data.user)
      setToken(result.data.token)
      setAuthenticatedSDK(result.data.sdk)

      // Persist to localStorage
      localStorage.setItem('authToken', result.data.token)
      localStorage.setItem('authUser', JSON.stringify(result.data.user))

      showSuccess(`Welcome, ${result.data.user.username}!`)
    } catch (error) {
      if (error instanceof Error && error.message !== 'Registration failed') {
        showError(`Network error: ${error.message}`)
      }
      throw error
    }
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    setAuthenticatedSDK(null)
    localStorage.removeItem('authToken')
    localStorage.removeItem('authUser')
    showInfo('Logged out successfully')
  }

  return (
    <AuthContext.Provider value={{ user, token, authenticatedSDK, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
