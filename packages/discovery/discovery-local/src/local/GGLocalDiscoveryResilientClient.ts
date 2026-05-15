import {GGLog} from "@grest-ts/logger";
import {IPCServer} from "@grest-ts/ipc";
import {GGLocalDiscoveryServer} from "./GGLocalDiscoveryServer";
import {GGLocalDiscoveryClient, getLocalDiscoveryPort} from "./GGLocalDiscoveryClient";
import {GGDiscoveryIPC, DiscoveryServerKind} from "./GGDiscoveryIPC";

export class GGLocalDiscoveryResilientClient extends GGLocalDiscoveryClient {

    private discoveryServer?: GGLocalDiscoveryServer;
    private isLeader = false;
    private isShuttingDown = false;
    /** Once any bin has held the port in this runtime's lifetime, never
     *  bid for it again. In-memory only. */
    private seenBinBasedMaster = false;

    constructor(port = getLocalDiscoveryPort()) {
        super(port);
    }

    public override async register(): Promise<void> {
        if (!this.isLeader && !this.discoveryServer && !this.client.isConnected()) {
            await this.becomeLeaderOrFollower();
        }
        await super.register();
    }

    public override async unregister(): Promise<void> {
        this.isShuttingDown = true;
        await super.unregister();

        if (this.discoveryServer) {
            await this.discoveryServer.teardown();
            this.discoveryServer = undefined;
        }
    }

    private async becomeLeaderOrFollower(): Promise<void> {
        if (this.isShuttingDown) return;
        if (this.seenBinBasedMaster) return this.connectToLeader();

        const router = new GGLocalDiscoveryServer(new IPCServer(this.port));
        if (await router.start()) {
            this.discoveryServer = router;
            this.isLeader = true;
            router.onYield = async () => {
                GGLog.warn(this, "Yielding leadership to authoritative discovery (bin); will not bid for the port again in this runtime");
                this.seenBinBasedMaster = true;
                this.isLeader = false;
                this.discoveryServer = undefined;
                await this.connectToLeader();
            };
            GGLog.info(this, "This instance is LEADER");
        } else {
            this.isLeader = false;
            GGLog.info(this, "This instance is FOLLOWER");
            await this.connectToLeader();
        }
    }

    private async connectToLeader(): Promise<void> {
        if (this.isShuttingDown) return;

        try {
            await this.client.connect();

            if (!this.seenBinBasedMaster) {
                const info = await this.client.sendFrameworkRequest(GGDiscoveryIPC.discoveryServer.getServerInfo, undefined);
                if (info.kind === DiscoveryServerKind.Bin) {
                    GGLog.warn(this, "Connected to authoritative discovery (bin); will not bid for the port in this runtime");
                    this.seenBinBasedMaster = true;
                }
            }

            this.client.onClose(async () => {
                if (this.isShuttingDown) return;
                GGLog.warn(this, "Leader died");
                await this.becomeLeaderOrFollower();
                if (this.isLeader && this.entries.length > 0) {
                    await super.register();
                }
            });

            GGLog.debug(this, "Connected to leader");
        } catch (err: any) {
            GGLog.error(this, `Discovery router not reachable on port ${this.port} — is @grest-ts/discovery-local running? Will retry. (${err.message || err.code || err})`);
            await this.delay(1000);
            await this.connectToLeader();
        }
    }

    protected override async ensureConnected(): Promise<void> {
        const maxRetries = 20;
        let retryCount = 0;

        while (true) {
            try {
                await super.ensureConnected();
                return;
            } catch (err: any) {
                if (retryCount < maxRetries && this.isConnectionError(err)) {
                    GGLog.debug(this, `Waiting for router...`);
                    await this.delay(Math.min(500 * Math.pow(1.5, retryCount), 5000));
                    retryCount++;
                    continue;
                }
                throw err;
            }
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private isConnectionError(err: any): boolean {
        const codes = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'];
        const hasCode = (code?: string) => code !== undefined && codes.includes(code);
        return hasCode(err?.code) ||
            hasCode(err?.cause?.code) ||
            hasCode(err?.originalError?.code) ||
            hasCode(err?.originalError?.cause?.code);
    }
}
