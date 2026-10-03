import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "browser.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node --import tsx tests/browser-server.ts",
      url: "http://127.0.0.1:3001/api/v1/health/live",
      reuseExistingServer: false,
    },
    {
      command: "npx vite --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
  reporter: "list",
});
