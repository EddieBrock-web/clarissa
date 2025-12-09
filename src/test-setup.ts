/**
 * Test setup file for bun:test
 * Handles yoga-layout WASM initialization to prevent flaky tests
 */
import { beforeAll, afterAll } from "bun:test";

// Import yoga-layout early to ensure WASM is initialized before tests
let yogaModule: unknown;

beforeAll(async () => {
  try {
    // Pre-initialize yoga-layout WASM to avoid race conditions between tests
    yogaModule = await import("yoga-layout");
  } catch {
    // yoga-layout may not be available in all environments
  }
});

afterAll(() => {
  // Clear reference to allow garbage collection
  yogaModule = undefined;
});

