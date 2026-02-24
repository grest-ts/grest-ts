import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react'

interface Notification {
  id: string
  message: string
  type: 'error' | 'success' | 'info'
}

interface NotificationContextType {
  showError: (message: string, duration?: number) => void
  showSuccess: (message: string, duration?: number) => void
  showInfo: (message: string, duration?: number) => void
  dismiss: (id: string) => void
}

const NotificationContext = createContext<NotificationContextType | null>(null)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([])

  const showNotification = useCallback((message: string, type: 'error' | 'success' | 'info', duration: number = 20000) => {
    const id = Date.now().toString()
    setNotifications(prev => [...prev, { id, message, type }])

    // Auto-dismiss after specified duration
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, duration)
  }, [])

  const showError = useCallback((message: string, duration?: number) => {
    showNotification(message, 'error', duration)
  }, [showNotification])

  const showSuccess = useCallback((message: string, duration?: number) => {
    showNotification(message, 'success', duration)
  }, [showNotification])

  const showInfo = useCallback((message: string, duration?: number) => {
    showNotification(message, 'info', duration)
  }, [showNotification])

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  return (
    <NotificationContext.Provider value={{ showError, showSuccess, showInfo, dismiss }}>
      {children}
      <NotificationContainer notifications={notifications} onDismiss={dismiss} />
    </NotificationContext.Provider>
  )
}

export function useNotification() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider')
  }
  return context
}

function NotificationContainer({ notifications, onDismiss }: { notifications: Notification[], onDismiss: (id: string) => void }) {
  return (
    <div style={{
      position: 'fixed',
      top: '1rem',
      right: '1rem',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      maxWidth: '400px',
    }}>
      {notifications.map(notification => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onDismiss={() => onDismiss(notification.id)}
        />
      ))}
    </div>
  )
}

function NotificationItem({ notification, onDismiss }: { notification: Notification, onDismiss: () => void }) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Trigger animation
    requestAnimationFrame(() => {
      setIsVisible(true)
    })
  }, [])

  const getBackgroundColor = () => {
    switch (notification.type) {
      case 'error': return '#dc3545'
      case 'success': return '#28a745'
      case 'info': return '#17a2b8'
    }
  }

  return (
    <div
      onClick={onDismiss}
      style={{
        background: getBackgroundColor(),
        color: 'white',
        padding: '1rem',
        borderRadius: '4px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        transform: isVisible ? 'translateX(0)' : 'translateX(100%)',
        opacity: isVisible ? 1 : 0,
        transition: 'all 0.3s ease-in-out',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: '0.25rem', textTransform: 'uppercase', fontSize: '0.75rem' }}>
        {notification.type}
      </div>
      <div>{notification.message}</div>
    </div>
  )
}
