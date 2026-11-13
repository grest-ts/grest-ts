import {execFileSync} from "node:child_process"
import {X509Certificate} from "node:crypto"
import {mkdtempSync, readFileSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

export function selfSignedCert(name: string): {cert: string, key: string, fingerprint256: string} {
    const dir = mkdtempSync(join(tmpdir(), "gg-addressing-"))
    try {
        const certPath = join(dir, "cert.pem")
        const keyPath = join(dir, "key.pem")
        execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", keyPath, "-out", certPath, "-subj", `/CN=${name}`], {stdio: "ignore"})
        const cert = readFileSync(certPath, "utf8")
        return {cert, key: readFileSync(keyPath, "utf8"), fingerprint256: new X509Certificate(cert).fingerprint256}
    } finally {
        rmSync(dir, {recursive: true, force: true})
    }
}
