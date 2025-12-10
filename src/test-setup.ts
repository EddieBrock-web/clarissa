/**
 * Test setup file for bun:test
 * Handles yoga-layout WASM initialization to prevent flaky tests
 */
import { beforeAll } from "bun:test";

beforeAll(async () => {
  try {
    // Pre-initialize yoga-layout WASM to avoid race conditions between tests
    await import("yoga-layout");
  } catch {
    // yoga-layout may not be available in all environments
  }
});

