import {GGContractImplementation} from "@grest-ts/schema"
import {BannerApiContract, BannerState} from "../../../api/BannerApi"
import {UserContext} from "../../../api/auth/UserAuth"

export class BannerService implements GGContractImplementation<typeof BannerApiContract["methods"]> {
    private count = 0
    private lastUsername = ""
    private onClicked: ((state: BannerState) => void) | undefined

    setOnClickedCallback(cb: (state: BannerState) => void): void {
        this.onClicked = cb
    }

    public bannerStatus = async (): Promise<{count: number}> => ({count: this.count})

    public clickBanner = async (): Promise<BannerState> => {
        this.count++
        this.lastUsername = UserContext.get()!.username
        const state: BannerState = {count: this.count, username: this.lastUsername}
        this.onClicked?.(state)
        return state
    }
}
