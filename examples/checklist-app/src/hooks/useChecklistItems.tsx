import { useState, useCallback } from 'react'
import { getErrorMessage, extractValidationErrors } from '../lib/errorHandler'
import {ChecklistItem} from "../UserAppSDK/http/ChecklistApiClient.gen.ts";
import {UserAppSDKAuthenticated} from "../UserAppSDK/UserAppSDK.gen.ts";
import {tChecklistId} from "../UserAppSDK/shared/shared-types.gen.ts";

interface UseChecklistItemsProps {
  authenticatedSDK: UserAppSDKAuthenticated | null
  showError: (msg: string) => void
  showSuccess: (msg: string) => void
}

export function useChecklistItems({ authenticatedSDK, showError, showSuccess }: UseChecklistItemsProps) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(false)

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

  const addItem = useCallback(async (title: string, description?: string) => {
    if (!authenticatedSDK) return { success: false, fieldErrors: {} }

    const result = await authenticatedSDK.checklist.add({
      title,
      description: description || undefined,
    })

    if (result.success === false) {
      const validationErrors = await extractValidationErrors(result)
      if (validationErrors && Object.keys(validationErrors).length > 0) {
        showError('Please fix the validation errors')
        return { success: false, fieldErrors: validationErrors }
      } else {
        showError(`Failed to add item: ${getErrorMessage(result)}`)
        return { success: false, fieldErrors: {} }
      }
    } else {
      setItems(prev => [...prev, result.data])
      showSuccess('Item added successfully!')
      return { success: true, fieldErrors: {} }
    }
  }, [authenticatedSDK, showError, showSuccess])

  const toggleDone = useCallback(async (id: tChecklistId) => {
    if (!authenticatedSDK) return

    const currentItem = items.find(item => item.id === id)
    if (!currentItem) return

    // Optimistic update
    const optimisticDone = !currentItem.done
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, done: optimisticDone } : item
    ))

    const result = await authenticatedSDK.checklist.markDone(id)

    if (result.success === false) {
      // Rollback on error
      setItems(prev => prev.map(item =>
        item.id === id ? { ...item, done: !optimisticDone } : item
      ))
      showError(`Failed to update item: ${getErrorMessage(result)}`)
    } else {
      // Update with server response
      setItems(prev => prev.map(item => item.id === id ? result.data : item))
    }
  }, [authenticatedSDK, items, showError])

  const editItem = useCallback(async (id: tChecklistId, title: string, description?: string) => {
    if (!authenticatedSDK) return false

    const result = await authenticatedSDK.checklist.edit(id, {
      title,
      description: description || undefined,
    })

    if (result.success === false) {
      showError(`Failed to update item: ${getErrorMessage(result)}`)
      return false
    } else {
      setItems(prev => prev.map(item => item.id === id ? result.data : item))
      showSuccess('Item updated successfully!')
      return true
    }
  }, [authenticatedSDK, showError, showSuccess])

  const deleteItem = useCallback(async (id: tChecklistId) => {
    if (!authenticatedSDK) return

    const result = await authenticatedSDK.checklist.delete(id)

    if (result.success === false) {
      showError(`Failed to delete item: ${getErrorMessage(result)}`)
    } else {
      setItems(prev => prev.filter(item => item.id !== id))
      showSuccess('Item deleted successfully!')
    }
  }, [authenticatedSDK, showError, showSuccess])

  const updateItemFromEvent = useCallback((updatedItem: ChecklistItem) => {
    setItems(prev => prev.map(item =>
      item.id === updatedItem.id ? updatedItem : item
    ))
  }, [])

  return {
    items,
    loading,
    loadItems,
    addItem,
    toggleDone,
    editItem,
    deleteItem,
    updateItemFromEvent,
    setItems
  }
}
