/**
 * SDK initialization and configuration
 */

import {UserAppSDK} from "../UserAppSDK/UserAppSDK.gen.ts";

/**
 * Create SDK instance with configured server URL
 *
 * Usage:
 * ```ts
 * import { sdk } from './lib/sdk'
 *
 * const result = await sdk.login({ username: 'alice', password: 'password' })
 * if (result.success) {
 *   const authenticatedSDK = result.sdk
 *   const items = await authenticatedSDK.checklist.list()
 * }
 * ```
 */
export const sdk = new UserAppSDK({
  url: import.meta.env.VITE_API_URL || 'http://localhost:9000'
})
