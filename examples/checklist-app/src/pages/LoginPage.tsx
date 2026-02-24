import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useForm } from '../hooks/useForm'
import { FormInput } from '../components/FormInput'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const loginForm = useForm({
    initialValues: { username: '', password: '' },
    onSubmit: async (values) => {
      await login(values.username, values.password)
      // Return a fake success result since useAuth.login throws on error
      return { success: true as const, data: null }
    },
    onSuccess: () => {
      navigate('/checklist')
    }
  })

  return (
    <div style={{ maxWidth: '400px' }}>
      <h2>Login</h2>
      <form onSubmit={loginForm.handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        <FormInput
          name="username"
          label="Username"
          type="text"
          value={loginForm.values.username}
          error={loginForm.errors.username}
          onChange={loginForm.handleChange('username')}
          disabled={loginForm.isSubmitting}
        />
        <FormInput
          name="password"
          label="Password"
          type="password"
          value={loginForm.values.password}
          error={loginForm.errors.password}
          onChange={loginForm.handleChange('password')}
          disabled={loginForm.isSubmitting}
        />
        <button type="submit" disabled={loginForm.isSubmitting}>
          {loginForm.isSubmitting ? 'Logging in...' : 'Login'}
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        Don't have an account? <Link to="/register">Register</Link>
      </p>
    </div>
  )
}
