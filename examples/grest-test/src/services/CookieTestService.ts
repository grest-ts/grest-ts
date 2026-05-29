import {SESSION} from "../api/CookieTestApi"

export class CookieTestService {

    public login = async (input: {user: string}): Promise<{ok: boolean}> => {
        SESSION.set(`session-for-${input.user}`, {maxAgeSec: 3600})   // write rules live here, at the set site
        return {ok: true}
    }

    public me = async (): Promise<{session: string | undefined}> => {
        return {session: SESSION.get()}
    }

    public logout = async (): Promise<{ok: boolean}> => {
        SESSION.set(undefined)
        return {ok: true}
    }

    // Changes the cookie on a route that did NOT declare .updatesCookie — the binding rejects it.
    public tamper = async (): Promise<{ok: boolean}> => {
        SESSION.set("tampered")
        return {ok: true}
    }
}
