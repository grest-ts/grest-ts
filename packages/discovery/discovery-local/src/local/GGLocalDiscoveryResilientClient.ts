import {GGLog} from "@grest-ts/logger";
import {IPCServer} from "@grest-ts/ipc";
import {GGLocalDiscoveryServer} from "./GGLocalDiscoveryServer";
import {GGLocalDiscoveryClient} from "./GGLocalDiscoveryClient";
import {GGDiscoveryIPC} from "./GGDiscoveryIPC";

export class GGLocalDiscoveryResilientClient extends GGLocalDiscoveryClient {

    private discoveryServer?: GGLocalDiscoveryServer;
    private isLeader = false;
    private isShuttingDown = false;
    /** Once a bin (the standalone `discovery-local` process) has held the
     *  port at any point in this runtime's lifetime, never bid for it
     *  again. The bin is authoritative; if it dies, discovery is broken
     *  until either it comes back or the runtime restarts. Per-runtime,
     *  in-memory only — a fresh runtime can still leader-elect. */
    private seenBin = false;

    constructor(port = 9000) {
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

        if (this.seenBin) {
            // Loyal to the bin — never bid, just wait for it to come back.
            GGLog.info(this, "Skipping leader bid (bin is authoritative)");
            await this.connectToLeader();
            return;
        }

        const server = new IPCServer(this.port);
        const router = new GGLocalDiscoveryServer(server);
        if (await router.start()) {
            this.discoveryServer = router;
            this.isLeader = true;
            router.onYield(() => this.handleYieldRequest());
            GGLog.info(this, "This instance is LEADER");
        } else {
            this.isLeader = false;
            GGLog.info(this, "This instance is FOLLOWER");
            await this.connectToLeader();
        }
    }

    /** Bin requested the port. Mark seenBin so we never re-bid, then
     *  teardown our server (releasing the port) and reconnect as a
     *  follower. The bin's retry loop will catch the freed port. */
    private async handleYieldRequest(): Promise<void> {
        if (this.isShuttingDown) return;
        GGLog.info(this, "Yielding port to authoritative discovery (bin)");
        this.seenBin = true;
        this.isLeader = false;
        const prev = this.discoveryServer;
        this.discoveryServer = undefined;
        if (prev) await prev.teardown();
        await this.connectToLeader();
    }

    private async connectToLeader(): Promise<void> {
        if (this.isShuttingDown) return;

        try {
            await this.client.connect();

            // Identify the holder. If it's a bin, lock out future bids
            // for this runtime's lifetime.
            if (!this.seenBin) {
                try {
                    const info = await this.client.sendFrameworkRequest(
                        GGDiscoveryIPC.discoveryServer.getServerInfo, undefined,
                    );
                    if (info.kind === "bin") {
                        this.seenBin = true;
                        GGLog.info(this, "Connected to bin discovery; locking out leader bids");
                    }
                } catch (err: any) {
                    // Older holders (pre-getServerInfo) won't answer —
                    // treat as embedded. Not load-bearing.
                    GGLog.debug(this, `getServerInfo skipped: ${err?.message}`);
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
            GGLog.error(this, `Failed to connect to leader: ${err.message}`);
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
