import { defineConfig } from "vitest/config"

// Only the pure modules in lib/ are tested in Node. Widgets need GJS and a Wayland session.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
  },
})
