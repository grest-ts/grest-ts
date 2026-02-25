import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/poller",
    description: "Poll-based job executor with leader election for single-master processing",
    keywords: ["polling", "job", "leader-election", "scheduler"],
    targets: {node: true},
    hasTests: true,
    extendsTestKit: true
})