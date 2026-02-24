import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useForm } from '../hooks/useForm'
import { FormInput } from '../components/FormInput'

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const registerForm = useForm({
    initialValues: { username: '', email: '', password: '' },
    onSubmit: async (values) => {
      await register(values.username, values.email, values.password)
      return { success: true as const, data: null }
    },
    onSuccess: () => {
      navigate('/checklist')
    }
  })

  return (
    <div style={{ maxWidth: '400px' }}>
      <h2>Register</h2>
      <form onSubmit={registerForm.handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        <FormInput
          name="username"
          label="Username"
          type="text"
          value={registerForm.values.username}
          error={registerForm.errors.username}
          onChange={registerForm.handleChange('username')}
          disabled={registerForm.isSubmitting}
        />
        <FormInput
          name="email"
          label="Email"
          type="email"
          value={registerForm.values.email}
          error={registerForm.errors.email}
          onChange={registerForm.handleChange('email')}
          disabled={registerForm.isSubmitting}
        />
        <FormInput
          name="password"
          label="Password"
          type="password"
          value={registerForm.values.password}
          error={registerForm.errors.password}
          onChange={registerForm.handleChange('password')}
          disabled={registerForm.isSubmitting}
        />
        <button type="submit" disabled={registerForm.isSubmitting}>
          {registerForm.isSubmitting ? 'Registering...' : 'Register'}
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </div>
  )
}
