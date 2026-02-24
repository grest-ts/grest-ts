import {GGHttpClientConfig} from "@grest-ts/http"
import {HelloApi} from "@newproject/api/api/HelloApi"

// Create typed API client. Vite proxy forwards /api/* to the server.
const clientConfig: GGHttpClientConfig = {url: ""}
const helloApi = HelloApi.createClient(clientConfig)

// ---

const nameInput = document.getElementById("nameInput") as HTMLInputElement
const callBtn = document.getElementById("callBtn") as HTMLButtonElement
const resultDiv = document.getElementById("result") as HTMLDivElement

callBtn.addEventListener("click", async () => {
    try {
        const response = await helloApi.hello({name: nameInput.value})
        resultDiv.textContent = response.message
        resultDiv.style.display = "block"
        resultDiv.className = ""
    } catch (err) {
        resultDiv.textContent = "Error: " + String(err)
        resultDiv.style.display = "block"
        resultDiv.className = "error"
    }
})
