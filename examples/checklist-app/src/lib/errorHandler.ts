/**
 * Validation issue from server (new format)
 */
interface ValidationIssue {
  path: string
  code: string
  message: string
  params?: object
}

/**
 * Extract validation errors into a field -> message mapping
 */
export async function extractValidationErrors(result: any): Promise<Record<string, string> | null> {
  if (result.success) return null
  if (result.type !== 'VALIDATION_ERROR') return null

  const errors = result.errors
  if (!errors) return null

  const fieldErrors: Record<string, string> = {}

  // New format: array of ValidationIssue objects
  if (Array.isArray(errors)) {
    for (const issue of errors as ValidationIssue[]) {
      const key = issue.path || '_root'
      fieldErrors[key] = issue.message
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null
}

/**
 * Format validation errors into a readable message
 */
function formatValidationErrors(errors: any): string {
  if (!errors) {
    return 'Invalid input'
  }

  // New format: array of ValidationIssue objects
  if (Array.isArray(errors)) {
    const fieldErrors: string[] = []
    for (const issue of errors as ValidationIssue[]) {
      const field = issue.path || '_root'
      fieldErrors.push(`${field}: ${issue.message}`)
    }
    return fieldErrors.length > 0 ? fieldErrors.join(', ') : 'Validation failed'
  }

  return 'Validation failed'
}

/**
 * Generic error handler for SDK results
 *
 * Checks the error type and returns a readable error message
 */
export function getErrorMessage(result: any): string {
  if (result.success) return 'An error occurred'

  switch (result.type) {
    case 'VALIDATION_ERROR':
      return formatValidationErrors(result.errors)
    case 'INVALID_CREDENTIALS':
      return 'Invalid username or password'
    case 'BAD_USERNAME':
      return `Invalid username: ${result.data?.reason || 'unknown reason'}`
    case 'SERVER_ERROR':
      return 'Server error'
    case 'NOT_AUTHORIZED':
      return 'Not authorized'
    case 'NOT_FOUND':
      return 'Not found'
    case 'FORBIDDEN':
      return 'Access forbidden'
    case 'EXISTS':
      return 'Already exists'
    default:
      return 'An error occurred'
  }
}
