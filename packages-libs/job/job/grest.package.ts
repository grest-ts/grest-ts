import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/job",
    description: "Recurring batch jobs that are safe to run on several instances",
    keywords: ["job", "scheduler", "cron", "batch", "distributed-lock"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    extendsTestKit: true,
})
