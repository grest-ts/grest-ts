import {definePackage} from "@grest-ts/x-packager";

definePackage({
    name: "@grest-ts/discovery-kubernetes",
    description: "Kubernetes service discovery implementation for Grest Framework",
    keywords: ["service-discovery", "kubernetes", "k8s"],
    targets: {node: true},
    implementationFor: "@grest-ts/package"
})
