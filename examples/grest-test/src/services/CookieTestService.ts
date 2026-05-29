import {SESSION} from "../api/CookieTestApi"

export class CookieTestService {

    public login = async (input: {user: string}): Promise<{ok: boolean}> => {
        SESSION.set(`session-for-${input.user}`)
        return {ok: true}
    }

    public me = async (): Promise<{session: string | undefined}> => {
        return {session: SESSION.get()}
    }

    public logout = async (): Promise<{ok: boolean}> => {
        SESSION.set(undefined)
        return {ok: true}
    }
}
