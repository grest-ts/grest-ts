import { useState } from 'react'
import { extractValidationErrors, getErrorMessage } from '../lib/errorHandler'

export interface UseFormOptions<T> {
  initialValues: T
  onSubmit: (values: T) => Promise<{ success: boolean, data?: any, transform?: any }>
  onSuccess?: (data: any) => void
  onError?: (message: string) => void
}

export interface UseFormReturn<T> {
  values: T
  errors: Record<string, string>
  isSubmitting: boolean
  setValues: (values: T) => void
  setValue: (name: keyof T, value: any) => void
  handleChange: (name: keyof T) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  handleSubmit: (e?: React.FormEvent) => Promise<void>
  clearError: (name: keyof T) => void
  clearErrors: () => void
  reset: () => void
}

/**
 * Custom hook for form state management with automatic validation error handling
 *
 * @example
 * const form = useForm({
 *   initialValues: { title: '', description: '' },
 *   onSubmit: async (values) => await sdk.checklist.add(values),
 *   onSuccess: () => showSuccess('Added!'),
 *   onError: (msg) => showError(msg)
 * })
 */
export function useForm<T extends Record<string, any>>(
  options: UseFormOptions<T>
): UseFormReturn<T> {
  const [values, setValues] = useState<T>(options.initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const setValue = (name: keyof T, value: any) => {
    setValues(prev => ({ ...prev, [name]: value }))
    // Clear error for this field when value changes
    if (errors[name as string]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[name as string]
        return newErrors
      })
    }
  }

  const handleChange = (name: keyof T) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setValue(name, e.target.value)
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    // Clear previous errors
    setErrors({})
    setIsSubmitting(true)

    try {
      const result = await options.onSubmit(values)

      if (result.success === false) {
        // Try to extract validation errors
        const validationErrors = await extractValidationErrors(result)

        if (validationErrors && Object.keys(validationErrors).length > 0) {
          // Show inline validation errors in the form
          setErrors(validationErrors)

          // Only show notification if there's a general error (not field-specific)
          if (options.onError && validationErrors._general) {
            options.onError(validationErrors._general)
          }
          // Don't show notification for field-specific validation errors
        } else {
          // Generic error - no field-specific validation errors
          const errorMessage = getErrorMessage(result)
          if (options.onError) {
            options.onError(errorMessage)
          }
        }
      } else {
        // Success - reset form and call onSuccess
        setValues(options.initialValues)
        setErrors({})

        if (options.onSuccess) {
          options.onSuccess(result.data)
        }
      }
    } catch (error) {
      // Unexpected error
      if (options.onError) {
        options.onError(error instanceof Error ? error.message : 'An unexpected error occurred')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const clearError = (name: keyof T) => {
    setErrors(prev => {
      const newErrors = { ...prev }
      delete newErrors[name as string]
      return newErrors
    })
  }

  const clearErrors = () => {
    setErrors({})
  }

  const reset = () => {
    setValues(options.initialValues)
    setErrors({})
  }

  return {
    values,
    errors,
    isSubmitting,
    setValues,
    setValue,
    handleChange,
    handleSubmit,
    clearError,
    clearErrors,
    reset,
  }
}
