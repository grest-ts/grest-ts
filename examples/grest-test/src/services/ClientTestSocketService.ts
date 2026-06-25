import {ClientTestSocketApi} from "../api/ClientTestSocketApi"

type Outgoing = typeof ClientTestSocketApi.serverToClient

export class ClientTestSocketService {

    private counter = 0
    private readonly connections = new Set<Outgoing>()

    public handleConnection = (incoming: typeof ClientTestSocketApi.clientToServer, outgoing: Outgoing): void => {
        this.connections.add(outgoing)
        outgoing.onClose(() => {
            this.connections.delete(outgoing)
        })

        incoming.on({
            echo: async ({message}) => ({
                message,
                echoedBy: "server",
            }),

            setCounter: async ({value}) => {
                this.counter = value
                for (const conn of this.connections) {
                    conn.counterChanged({value})
                }
            },

            getCounter: async () => ({value: this.counter}),

            askMeAQuestion: async ({prompt}) => {
                return await outgoing.needsConfirmation({prompt})
            },
        })
    }
}
