// ---------------------------------------------
// THIS FILE IS GENERATED - DO NOT EDIT
// ---------------------------------------------

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      'packages-libs/auth/auth',
      'packages-libs/docs/api-docs',
      'packages-libs/docs/asyncapi',
      'packages-libs/docs/openapi',
      'packages-libs/lock/lock',
      'packages-libs/poller',
      'packages-libs/struct',
      'packages-tooling/code-generator',
      'packages-tooling/testkit/testkit',
      'packages-tooling/testkit/testkit-vitest',
      'packages/context',
      'packages/discovery/discovery-local',
      'packages/locator',
      'packages/schema/schema',
      'packages/trace/trace',
      'packages/trace/trace-http',
      'examples/checklist',
      'examples/grest-test',
      'examples/auth/server'
    ]
  }
})
