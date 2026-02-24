import {ConfigTestResponse, DelayedLogRequest, IConfigTestApi, LogRequest, LogResponse, ObjectConfigResponse} from "../api/ConfigTestApi";
import {MainConfigApi, TestObjectSettings} from "../MainConfig.api";
import {ConfigTestSocketApiClientToServer, ConfigTestSocketApiServerToClient} from "../api/ConfigTestSocketApi";
import {WebSocketIncoming, WebSocketOutgoing} from "@grest-ts/websocket";
import {GGLog} from "@grest-ts/logger";

type IncomingHandler = WebSocketIncoming<ConfigTestSocketApiClientToServer>
type OutgoingConnection = WebSocketOutgoing<ConfigTestSocketApiServerToClient>

export class ConfigTestService implements IConfigTestApi {
    private watchedTimeout: number | undefined;
    private watchedObjectConfig: TestObjectSettings | undefined;
    private connectedClients = new Set<OutgoingConnection>();

    constructor() {
        MainConfigApi.settings.timeout.watch((newValue) => {
            GGLog.info(this, "Config timeout changed", {oldValue: this.watchedTimeout, newValue});
            this.watchedTimeout = newValue;
            // Broadcast config change to all connected WebSocket clients
            this.broadcastConfigChange();
        });

        MainConfigApi.settings.objectConfig.watch((newValue) => {
            GGLog.info(this, "Config objectConfig changed", {oldValue: this.watchedObjectConfig, newValue});
            this.watchedObjectConfig = newValue;
        });
    }

    public async getWatchedValue(): Promise<ConfigTestResponse> {
        return {
            watchedTimeout: this.watchedTimeout ?? 0
        };
    }

    public async getObjectConfig(): Promise<ObjectConfigResponse> {
        // Use watcher value (updated by watch callback) OR get() for initial value
        return {
            objectConfig: this.watchedObjectConfig ?? MainConfigApi.settings.objectConfig.get()
        };
    }

    public async logMessage(request: LogRequest): Promise<LogResponse> {
        GGLog.debug(this, "Log message: " + request.message);
        return {
            logged: true,
            message: request.message
        };
    }

    public async logDelayed(request: DelayedLogRequest): Promise<void> {
        setTimeout(() => {
            GGLog.debug(this, "Delayed log: " + request.message);
        }, request.delayMs);
    }

    public handleSocketConnection = (incoming: IncomingHandler, outgoing: OutgoingConnection): void => {
        this.connectedClients.add(outgoing);

        incoming.on({
            getWatchedValue: async (): Promise<ConfigTestResponse> => {
                return this.getWatchedValue();
            }
        });

        outgoing.onClose(() => {
            this.connectedClients.delete(outgoing);
        });
    }

    private broadcastConfigChange(): void {
        const response: ConfigTestResponse = {
            watchedTimeout: this.watchedTimeout ?? 0
        };
        this.connectedClients.forEach(client => {
            client.configChanged(response);
        });
    }
}
