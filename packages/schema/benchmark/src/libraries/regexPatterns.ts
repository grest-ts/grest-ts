/**
 * Shared constants for validation benchmarks.
 * These are used across all library adapters for fair comparison.
 */

// Refinement regex patterns
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const URL_REGEX = /^https?:\/\/.+/;
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
export const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/;

// Regex patterns as strings (for libraries that need string patterns)
export const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";
export const URL_PATTERN = "^https?://.+";
export const PASSWORD_PATTERN = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{8,}$";
export const ALPHANUMERIC_PATTERN = "^[a-zA-Z0-9]+$";
