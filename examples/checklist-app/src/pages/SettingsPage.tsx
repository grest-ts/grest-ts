import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import { useNotification } from '../hooks/useNotification'
import { useForm } from '../hooks/useForm'
import { FormInput } from '../components/FormInput'

export function SettingsPage() {
  const { user, authenticatedSDK } = useAuth()
  const navigate = useNavigate()
  const { showError, showSuccess } = useNotification()

  const passwordForm = useForm({
    initialValues: { oldPassword: '', newPassword: '', confirmPassword: '' },
    onSubmit: async (values) => {
      if (!authenticatedSDK) throw new Error('Not authenticated')
      return await authenticatedSDK.userAuth.changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword
      })
    },
    onSuccess: () => {
      showSuccess('Password changed successfully!')
    },
    onError: (message) => showError(message)
  })

  if (!user || !authenticatedSDK) {
    navigate('/login')
    return null
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Settings</h2>
        <button onClick={() => navigate('/checklist')} style={{ background: '#6c757d' }}>
          Back to Checklist
        </button>
      </div>

      <div className="add-item-section">
        <h3>Account Information</h3>
        <div style={{ marginBottom: '1rem' }}>
          <strong>Username:</strong> {user.username}
        </div>
        <div>
          <strong>Email:</strong> {user.email}
        </div>
      </div>

      <div className="add-item-section">
        <h3>Change Password</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '400px' }}>
          <FormInput
            name="oldPassword"
            label="Old Password"
            type="password"
            placeholder="Enter old password"
            value={passwordForm.values.oldPassword}
            error={passwordForm.errors.oldPassword}
            onChange={passwordForm.handleChange('oldPassword')}
            disabled={passwordForm.isSubmitting}
          />

          <FormInput
            name="newPassword"
            label="New Password"
            type="password"
            placeholder="Enter new password"
            value={passwordForm.values.newPassword}
            error={passwordForm.errors.newPassword}
            onChange={passwordForm.handleChange('newPassword')}
            disabled={passwordForm.isSubmitting}
          />

          <FormInput
            name="confirmPassword"
            label="Confirm New Password"
            type="password"
            placeholder="Confirm new password"
            value={passwordForm.values.confirmPassword}
            error={passwordForm.errors.confirmPassword}
            onChange={passwordForm.handleChange('confirmPassword')}
            disabled={passwordForm.isSubmitting}
          />

          <button
            onClick={() => passwordForm.handleSubmit()}
            disabled={passwordForm.isSubmitting}
            style={{ background: '#007bff' }}
          >
            {passwordForm.isSubmitting ? 'Changing Password...' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  )
}
