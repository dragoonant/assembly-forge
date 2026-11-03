import { defineConfig, devices } from '@playwright/test'

// PW_PORT lets a run avoid a port another project already holds.
const PORT = Number(process.env.PW_PORT ?? 5311)
// The preview server serves the production build under the Pages sub-path (see vite.config.ts).
const BASE_URL = `http://localhost:${PORT}/assembly-forge/`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',
  // The board renders in software GL under headless Chromium, so run one test at a time.
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: 'list',
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
