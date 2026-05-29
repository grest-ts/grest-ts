import {SESSION} from "../api/CookieTestApi"

export class CookieTestService {

    public login = async (input: {user: string}): Promise<{ok: boolean}> => {
        SESSION.issue(`session-for-${input.user}`, {maxAgeSec: 3600})
        return {ok: true}
    }

    public me = async (): Promise<{session: string | undefined}> => {
        return {session: SESSION.get()}
    }

    public logout = async (): Promise<{ok: boolean}> => {
        SESSION.clear()
        return {ok: true}
    }

    public badIssue = async (): Promise<{ok: boolean}> => {
        SESSION.issue("should-not-reach-the-wire")
        return {ok: true}
    }
}
