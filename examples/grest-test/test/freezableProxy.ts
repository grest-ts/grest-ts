import net from "node:net"

/** A TCP hop in front of `targetUrl` that can go silent without closing: a half-open link, as after a laptop sleep.
 *  `freeze()` silences the connections open now; later ones pass through. */
export async function freezableProxy(targetUrl: string): Promise<{url: string, freeze(): void, close(): Promise<void>}> {
    const target = new URL(targetUrl)
    const pairs: net.Socket[][] = []
    let live = 0
    const server = net.createServer(client => {
        const upstream = net.connect(Number(target.port), target.hostname)
        client.pipe(upstream).pipe(client)
        client.on("error", () => {})
        upstream.on("error", () => {})
        pairs.push([client, upstream])
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const {port} = server.address() as net.AddressInfo
    return {
        url: `http://127.0.0.1:${port}`,
        freeze: () => {
            for (const [client, upstream] of pairs.slice(live)) {
                client.unpipe(upstream)
                upstream.unpipe(client)
            }
            live = pairs.length
        },
        close: async () => {
            for (const [client, upstream] of pairs.splice(0)) {
                client.destroy()
                upstream.destroy()
            }
            await new Promise<void>(resolve => server.close(() => resolve()))
        },
    }
}
