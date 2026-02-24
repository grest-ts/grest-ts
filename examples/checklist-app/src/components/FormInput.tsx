import React from 'react'

export interface FormInputProps {
  name: string
  label?: string
  placeholder?: string
  type?: 'text' | 'password' | 'email'
  value: string
  error?: string
  disabled?: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * Form input component with automatic error display
 *
 * @example
 * <FormInput
 *   name="title"
 *   label="Title"
 *   placeholder="Enter title"
 *   value={values.title}
 *   error={errors.title}
 *   onChange={handleChange('title')}
 * />
 */
export function FormInput({
  name,
  label,
  placeholder,
  type = 'text',
  value,
  error,
  disabled,
  onChange,
}: FormInputProps) {
  return (
    <div>
      {label && (
        <label htmlFor={name} style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
          {label}
        </label>
      )}
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        disabled={disabled}
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
