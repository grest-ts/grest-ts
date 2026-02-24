import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/intl",
    description: "Internationalization and localization library with typed message descriptors",
    keywords: ["i18n", "internationalization", "localization"],
    targets: {node: true, browser: true},
    dependencies: {
        "i18next": "^25.8.10",
        "i18next-icu": "^2.4.3"
    }
})
