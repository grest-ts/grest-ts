// ---------------------------------------------
// THIS FILE IS GENERATED - DO NOT EDIT
// ---------------------------------------------

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      'packages-libs/asyncapi',
      'packages-libs/lock/lock',
      'packages-libs/openapi',
      'packages-libs/poller',
      'packages-libs/struct',
      'packages-tooling/code-generator',
      'packages-tooling/testkit/testkit',
      'packages-tooling/testkit/testkit-vitest',
      'packages/context',
      'packages/locator',
      'packages/schema/schema',
      'packages/trace/trace',
      'packages/trace/trace-http',
      'examples/checklist',
      'examples/grest-test'
    ]
  }
})
