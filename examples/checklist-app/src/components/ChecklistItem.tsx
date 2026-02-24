import type { ChecklistItem } from '@checklist/client/src/UserAppSDK/http/ChecklistApiClient.gen'
import type { tChecklistId } from '@checklist/client/src/UserAppSDK/shared/shared-types.gen'

interface ChecklistItemProps {
  item: ChecklistItem
  isEditing: boolean
  editTitle: string
  editDescription: string
  onToggleDone: (id: tChecklistId) => void
  onEdit: (item: ChecklistItem) => void
  onDelete: (id: tChecklistId) => void
  onSave: (id: tChecklistId) => void
  onSaveSocket: (id: tChecklistId) => void
  onCancel: () => void
  onEditTitleChange: (value: string) => void
  onEditDescriptionChange: (value: string) => void
  socketConnected: boolean
}

export function ChecklistItemComponent({
  item,
  isEditing,
  editTitle,
  editDescription,
  onToggleDone,
  onEdit,
  onDelete,
  onSave,
  onSaveSocket,
  onCancel,
  onEditTitleChange,
  onEditDescriptionChange,
  socketConnected
}: ChecklistItemProps) {
  return (
    <div className={`checklist-item ${item.done ? 'done' : ''}`}>
      <label className="custom-checkbox">
        <input
          type="checkbox"
          checked={item.done}
          onChange={() => onToggleDone(item.id)}
          disabled={isEditing}
        />
        <span className="checkmark"></span>
      </label>

      <div className="checklist-item-content">
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => onEditTitleChange(e.target.value)}
              placeholder="Title"
              autoFocus
            />
            <textarea
              value={editDescription}
              onChange={(e) => onEditDescriptionChange(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
            />
          </div>
        ) : (
          <>
            <div className="checklist-item-title">{item.title}</div>
            {item.description && (
              <div className="checklist-item-description">{item.description}</div>
            )}
            <div className="checklist-item-meta">
              <span>Created {new Date(item.createdAt).toLocaleDateString()}</span>
              {item.address && <span>📍 {item.address}</span>}
            </div>
          </>
        )}
      </div>

      <div className="checklist-item-actions">
        {isEditing ? (
          <>
            <button onClick={() => onSave(item.id)} style={{ background: '#28a745' }}>
              Save
            </button>
            {socketConnected && (
              <button onClick={() => onSaveSocket(item.id)} style={{ background: '#17a2b8' }}>
                Save (Socket)
              </button>
            )}
            <button onClick={onCancel} style={{ background: '#6c757d' }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => onEdit(item)} style={{ background: '#007bff' }}>
              Edit
            </button>
            <button onClick={() => onDelete(item.id)} className="btn-delete">
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}
