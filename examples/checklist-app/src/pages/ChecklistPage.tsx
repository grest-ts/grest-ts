import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'
import { useNotification } from '../hooks/useNotification'
import { useSocket } from '../hooks/useSocket'
import { useForm } from '../hooks/useForm'
import { getErrorMessage } from '../lib/errorHandler'
import { FormInput } from '../components/FormInput'
import { FormTextarea } from '../components/FormTextarea'
import type { ChecklistItem } from '../UserAppSDK/http/ChecklistApiClient.gen'
import type { tChecklistId } from '../UserAppSDK/shared/shared-types.gen'
import type { ItemMarkedEvent } from '../UserAppSDK/websocket/ChecklistNotificationApiClient.gen'

export function ChecklistPage() {
  const { user, authenticatedSDK } = useAuth()
  const navigate = useNavigate()
  const { showError, showSuccess } = useNotification()
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<tChecklistId | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')

  // Add item form
  const addForm = useForm({
    initialValues: { title: '', description: '' },
    onSubmit: async (values) => {
      if (!authenticatedSDK) throw new Error('Not authenticated')
      return await authenticatedSDK.checklist.add({
        title: values.title,
        description: values.description || undefined
      })
    },
    onSuccess: (data) => {
      setItems([...items, data])
      showSuccess('Item added successfully!')
    },
    onError: (message) => showError(message)
  })

  // WebSocket connection
  const handleItemMarked = useCallback((event: ItemMarkedEvent) => {
    // Update the item in the list when another user marks it
    setItems(prev => prev.map(item =>
      item.id === event.item.id ? event.item : item
    ))
  }, [])

  const { connected, updateItemViaSocket, askIfIAmHere } = useSocket(
    authenticatedSDK,
    handleItemMarked
  )

  const loadItems = useCallback(async () => {
    if (!authenticatedSDK) return

    setLoading(true)
    const result = await authenticatedSDK.checklist.list()

    if (result.success === false) {
      showError(`Failed to load items: ${getErrorMessage(result)}`)
    } else {
      setItems(result.data)
    }

    setLoading(false)
  }, [authenticatedSDK, showError])

  useEffect(() => {
    if (!user || !authenticatedSDK) {
      navigate('/login')
      return
    }

    loadItems()
  }, [user, authenticatedSDK, navigate, loadItems])


  const handleToggleDone = async (id: tChecklistId) => {
    if (!authenticatedSDK) return

    // Find the current item to get its current done state
    const currentItem = items.find(item => item.id === id)
    if (!currentItem) return

    // Optimistic update - immediately toggle the done state in the UI
    const optimisticDone = !currentItem.done
    setItems(items.map(item =>
      item.id === id ? { ...item, done: optimisticDone } : item
    ))

    // Make the API call
    const result = await authenticatedSDK.checklist.markDone(id)

    if (result.success === false) {
      // Rollback on error - revert to the original state
      setItems(items.map(item =>
        item.id === id ? { ...item, done: !optimisticDone } : item
      ))
      showError(`Failed to update item: ${getErrorMessage(result)}`)
    } else {
      // Update with the server response to ensure consistency
      setItems(items.map(item => item.id === id ? result.data : item))
    }
  }

  const handleDelete = async (id: tChecklistId) => {
    if (!authenticatedSDK) return

    const result = await authenticatedSDK.checklist.delete(id)

    if (result.success === false) {
      showError(`Failed to delete item: ${getErrorMessage(result)}`)
    } else {
      setItems(items.filter(item => item.id !== id))
      showSuccess('Item deleted successfully!')
    }
  }

  const handleEdit = (item: ChecklistItem) => {
    setEditingId(item.id)
    setEditTitle(item.title)
    setEditDescription(item.description || '')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
    setEditDescription('')
  }

  const handleSaveEdit = async (id: tChecklistId) => {
    if (!authenticatedSDK || !editTitle.trim()) {
      showError('Title is required')
      return
    }

    const result = await authenticatedSDK.checklist.edit({
      id: id,
      title: editTitle,
      description: editDescription || undefined,
    })

    if (result.success === false) {
      showError(`Failed to update item: ${getErrorMessage(result)}`)
    } else {
      setItems(items.map(item => item.id === id ? result.data : item))
      setEditingId(null)
      setEditTitle('')
      setEditDescription('')
      showSuccess('Item updated successfully!')
    }
  }

  const handleSaveEditViaSocket = async (id: tChecklistId) => {
    if (!editTitle.trim()) {
      showError('Title is required')
      return
    }

    // Find the current item to send the full updated object
    const currentItem = items.find(item => item.id === id)
    if (!currentItem) return

    const updatedItem: ChecklistItem = {
      ...currentItem,
      title: editTitle,
      description: editDescription || undefined,
      updatedAt: Date.now()
    }

    // Send via WebSocket
    await updateItemViaSocket(updatedItem)

    // Update local state
    setItems(items.map(item => item.id === id ? updatedItem : item))
    setEditingId(null)
    setEditTitle('')
    setEditDescription('')
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', marginTop: '2rem' }}>
        <p>Loading checklist items...</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>My Checklist</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            fontSize: '0.85rem',
            background: connected ? '#d4edda' : '#f8d7da',
            color: connected ? '#155724' : '#721c24',
            border: `1px solid ${connected ? '#c3e6cb' : '#f5c6cb'}`
          }}>
            WebSocket: {connected ? '✓ Connected' : '✗ Disconnected'}
          </div>
          {connected && (
            <button onClick={askIfIAmHere} style={{ background: '#17a2b8', padding: '0.5rem 1rem' }}>
              Ask If I'm Here
            </button>
          )}
        </div>
      </div>

      <div className="add-item-section">
        <h3>Add New Item</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <FormInput
            name="title"
            placeholder="Title"
            value={addForm.values.title}
            error={addForm.errors.title}
            onChange={addForm.handleChange('title')}
            disabled={addForm.isSubmitting}
          />
          <FormTextarea
            name="description"
            placeholder="Description (optional)"
            value={addForm.values.description}
            error={addForm.errors.description}
            onChange={addForm.handleChange('description')}
            disabled={addForm.isSubmitting}
            rows={3}
          />
          <button onClick={() => addForm.handleSubmit()} disabled={addForm.isSubmitting}>
            {addForm.isSubmitting ? 'Adding...' : 'Add Item'}
          </button>
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: '1rem' }}>
          {items.length === 0 ? 'Your Items' : `${items.filter(i => !i.done).length} active, ${items.filter(i => i.done).length} completed`}
        </h3>
        {items.length === 0 ? (
          <div className="checklist-empty">
            <div className="checklist-empty-icon">📝</div>
            <p>No items yet. Add your first one above!</p>
          </div>
        ) : (
          <div>
            {items.map((item) => (
              <div
                key={item.id}
                className={`checklist-item ${item.done ? 'done' : ''}`}
              >
                <label className="custom-checkbox">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => handleToggleDone(item.id)}
                    disabled={editingId === item.id}
                  />
                  <span className="checkmark"></span>
                </label>
                <div className="checklist-item-content">
                  {editingId === item.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Title"
                        autoFocus
                      />
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Description (optional)"
                        rows={2}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="checklist-item-title">
                        {item.title}
                      </div>
                      {item.description && (
                        <div className="checklist-item-description">
                          {item.description}
                        </div>
                      )}
                      <div className="checklist-item-meta">
                        <span>Created {new Date(item.createdAt).toLocaleDateString()}</span>
                        {item.address && <span>📍 {item.address}</span>}
                      </div>
                    </>
                  )}
                </div>
                <div className="checklist-item-actions">
                  {editingId === item.id ? (
                    <>
                      <button onClick={() => handleSaveEdit(item.id)} style={{ background: '#28a745' }}>
                        Save
                      </button>
                      {connected && (
                        <button onClick={() => handleSaveEditViaSocket(item.id)} style={{ background: '#17a2b8' }}>
                          Save (Socket)
                        </button>
                      )}
                      <button onClick={handleCancelEdit} style={{ background: '#6c757d' }}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleEdit(item)} style={{ background: '#007bff' }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(item.id)} className="btn-delete">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
