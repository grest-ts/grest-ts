import React from 'react'

export interface FormTextareaProps {
  name: string
  label?: string
  placeholder?: string
  value: string
  error?: string
  disabled?: boolean
  rows?: number
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}

/**
 * Form textarea component with automatic error display
 *
 * @example
 * <FormTextarea
 *   name="description"
 *   label="Description"
 *   placeholder="Enter description"
 *   value={values.description}
 *   error={errors.description}
 *   onChange={handleChange('description')}
 *   rows={3}
 * />
 */
export function FormTextarea({
  name,
  label,
  placeholder,
  value,
  error,
  disabled,
  rows = 3,
  onChange,
}: FormTextareaProps) {
  return (
    <div>
      {label && (
        <label htmlFor={name} style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
          {label}
        </label>
      )}
      <textarea
        id={name}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
        rows={rows}
        className={error ? 'error' : ''}
      />
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
    </div>
  )
}
