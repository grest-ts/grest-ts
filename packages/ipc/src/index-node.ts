import "./_dedupCheck";
export * from './server/IPCServer'
export * from './client/IPCClient'
export * from './common/IPCSocket'
export * from './common/IPCTypes'
export {INTERNAL_SOCKET_PATH} from './server/SocketHandler'
export type {SocketMessage, ClientDisconnectListener} from './server/SocketHandler'
