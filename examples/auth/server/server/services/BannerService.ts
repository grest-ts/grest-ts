import {BannerApiContract, BannerState} from "../../../api/BannerApi"
import {USER_DATA} from "../auth/UserAuthHandler"

type IBannerApi = typeof BannerApiContract.infer

export class BannerService implements IBannerApi {
    private count = 0
    private lastUsername = ""
    private onClicked: ((state: BannerState) => void) | undefined

    setOnClickedCallback(cb: (state: BannerState) => void): void {
        this.onClicked = cb
    }

    public bannerStatus = async (): Promise<{count: number}> => ({count: this.count})

    public clickBanner = async (): Promise<BannerState> => {
        this.count++
        this.lastUsername = USER_DATA.get()!.username
        const state: BannerState = {count: this.count, username: this.lastUsername}
        this.onClicked?.(state)
        return state
    }
}
