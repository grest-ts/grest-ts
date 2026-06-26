import {defineConfig} from "vitepress"
import {withMermaid} from "vitepress-plugin-mermaid"
import sidebar from "../src/_generated_sidebar.json"

export default withMermaid(defineConfig({
    title: "grest-ts",
    description: "Contract-First TypeScript Services",
    srcDir: "src",
    outDir: "build",
    appearance: "dark",
    cleanUrls: true,
    ignoreDeadLinks: true,

    head: [
        ["script", {async: "", src: "https://www.googletagmanager.com/gtag/js?id=G-Z2BGL7EF57"}],
        ["script", {}, "window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', 'G-Z2BGL7EF57');"],
    ],

    markdown: {
        theme: {dark: "github-dark", light: "github-light"},
    },

    vite: {
        server: {allowedHosts: true},
        preview: {allowedHosts: true},
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
