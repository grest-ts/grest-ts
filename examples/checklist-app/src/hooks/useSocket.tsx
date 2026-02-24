import { useState, useEffect, useCallback, useRef } from 'react'
import { useNotification } from './useNotification'
import {ChecklistNotificationApiClient, ItemMarkedEvent} from "../UserAppSDK/websocket/ChecklistNotificationApiClient.gen.ts";
import {ChecklistItem} from "../UserAppSDK/http/ChecklistApiClient.gen.ts";
import {UserAppSDKAuthenticated} from "../UserAppSDK/UserAppSDK.gen.ts";

interface UseSocketReturn {
  socket: ChecklistNotificationApiClient | null
  connected: boolean
  updateItemViaSocket: (item: ChecklistItem) => Promise<void>
  askIfIAmHere: () => void
}

export function useSocket(
  authenticatedSDK: UserAppSDKAuthenticated | null,
  onItemMarked?: (event: ItemMarkedEvent) => void
): UseSocketReturn {
  const [socket, setSocket] = useState<ChecklistNotificationApiClient | null>(null)
  const [connected, setConnected] = useState(false)
  const { showInfo, showSuccess, showError } = useNotification()

  // Use refs to track connection state across React.StrictMode double-invocations
  const socketRef = useRef<ChecklistNotificationApiClient | null>(null)
  const connectingRef = useRef<Promise<ChecklistNotificationApiClient> | null>(null)
  const connectionIdRef = useRef(0)

  useEffect(() => {
    if (!authenticatedSDK) {
      setSocket(null)
      setConnected(false)
      return
    }

    // Increment connection ID to invalidate stale callbacks
    const currentConnectionId = ++connectionIdRef.current

    // If we already have a completed socket, reuse it
    if (socketRef.current) {
      setSocket(socketRef.current)
      setConnected(true)
      return
    }

    // If a connection is already in progress, wait for it instead of starting a new one
    if (connectingRef.current) {
      connectingRef.current.then((socketClient) => {
        if (currentConnectionId === connectionIdRef.current) {
          setSocket(socketClient)
          setConnected(true)
        }
      }).catch(() => {
        // Error already handled by the original connection attempt
      })
      return
    }

    const connectSocket = async (): Promise<ChecklistNotificationApiClient> => {
      const socketClient = await authenticatedSDK.connectChecklistNotification({
        itemMarked: (event: ItemMarkedEvent) => {
          console.log('Item marked event received:', event)
          showInfo(`${event.markedBy} marked an item`)
          if (onItemMarked) {
            onItemMarked(event)
          }
        },
        areYouThere: async () => {
          console.log('Server asked: Are you there?')
          showInfo('Server asked: Are you there? 👋', 2000)
          return true
        }
      })
      return socketClient
    }

    // Store the connection promise so subsequent effect runs can wait for it
    const connectionPromise = connectSocket()
    connectingRef.current = connectionPromise

    connectionPromise
      .then((socketClient) => {
        // Only update state if this is still the current connection attempt
        if (currentConnectionId === connectionIdRef.current) {
          socketRef.current = socketClient
          setSocket(socketClient)
          setConnected(true)
          showSuccess('WebSocket connected!')
        }
        // Clear the pending promise after successful connection
        connectingRef.current = null
      })
      .catch((error) => {
        console.error('Failed to connect socket:', error)
        connectingRef.current = null
        if (currentConnectionId === connectionIdRef.current) {
          showError(`WebSocket connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      })

    return () => {
      // On cleanup, close the socket if we own it
      if (socketRef.current && currentConnectionId === connectionIdRef.current) {
        socketRef.current.close()
        socketRef.current = null
        connectingRef.current = null
        setSocket(null)
        setConnected(false)
      }
    }
  }, [authenticatedSDK])

  const updateItemViaSocket = useCallback(async (item: ChecklistItem) => {
    if (!socket) {
      showError('WebSocket not connected')
      return
    }

    try {
      const response = await socket.updateItem(item)
      showSuccess(`Socket: ${response.message}`)
    } catch (error) {
      showError(`Socket update error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [socket, showSuccess, showError])

  const askIfIAmHere = useCallback(() => {
    if (!socket) {
      showError('WebSocket not connected')
      return
    }

    socket.askMeAmIHere()
    showInfo('Asking server if I am here...', 2000)
  }, [socket, showError, showInfo])

  return {
    socket,
    connected,
    updateItemViaSocket,
    askIfIAmHere
  }
}
