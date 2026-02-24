import DefaultTheme from "vitepress/theme"
import {watch, nextTick, onMounted} from "vue"
import {useRoute} from "vitepress"
import "./custom.css"

export default {
    extends: DefaultTheme,
    setup() {
        const route = useRoute()
        onMounted(() => {
            watch(() => route.path, () => {
                nextTick(() => {
                    // Collapse all open groups that don't contain the active page
                    document.querySelectorAll(
                        ".VPSidebarItem.collapsible:not(.has-active):not(.collapsed) .caret"
                    ).forEach(el => (el as HTMLElement).click())
                })
            })
        })
    },
}
