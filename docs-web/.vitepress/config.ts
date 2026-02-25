import {defineConfig} from "vitepress"
import {withMermaid} from "vitepress-plugin-mermaid"
import sidebar from "../src/_generated_sidebar.json"

export default withMermaid(defineConfig({
    title: "grest-ts",
    description: "Contract-First TypeScript Services",
    srcDir: "src",
    outDir: "build",
    appearance: "dark",
    ignoreDeadLinks: true,

    markdown: {
        theme: {dark: "github-dark", light: "github-light"},
    },

    themeConfig: {
        logo: "/logo.png",
        sidebar,

        nav: [
            {text: "Guide", link: "/guide/"},
            {text: "Packages", link: "/packages/"},
            {text: "GitHub", link: "https://github.com/grest-ts/grest-ts"},
        ],

        search: {provider: "local"},

        outline: {level: [2, 3]},

        socialLinks: [
            {icon: "github", link: "https://github.com/grest-ts/grest-ts"},
        ],
    },
}))
