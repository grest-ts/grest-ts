import {GGCookie} from "@grest-ts/http"
import {SESSION} from "../api/CookieTestApi"

export class CookieTestService {

    public login = async (input: {user: string}): Promise<{ok: boolean}> => {
        GGCookie.setCookie(SESSION, `session-for-${input.user}`, {maxAgeSec: 3600})   // write rules live here, at the set site
        return {ok: true}
    }

    public me = async (): Promise<{session: string | undefined}> => {
        return {session: SESSION.get()}
    }

    public logout = async (): Promise<{ok: boolean}> => {
        GGCookie.clearCookie(SESSION)
        return {ok: true}
    }

    // Writes the cookie on a route that did NOT declare .updatesCookie — setCookie rejects it.
    public tamper = async (): Promise<{ok: boolean}> => {
        GGCookie.setCookie(SESSION, "tampered")
        return {ok: true}
    }
}
