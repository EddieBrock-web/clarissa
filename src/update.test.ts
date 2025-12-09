import { test, expect, describe } from "bun:test";
import { isNewerVersion, CURRENT_VERSION, PACKAGE_NAME } from "./update.ts";

describe("Update Module", () => {
  describe("isNewerVersion", () => {
    test("returns true when latest major is higher", () => {
      expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
      expect(isNewerVersion("0.9.9", "1.0.0")).toBe(true);
    });

    test("returns true when latest minor is higher", () => {
      expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true);
      expect(isNewerVersion("1.5.0", "1.6.0")).toBe(true);
    });

    test("returns true when latest patch is higher", () => {
      expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
      expect(isNewerVersion("1.0.5", "1.0.10")).toBe(true);
    });

    test("returns false when versions are equal", () => {
      expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
      expect(isNewerVersion("2.5.3", "2.5.3")).toBe(false);
    });

    test("returns false when current is newer", () => {
      expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
      expect(isNewerVersion("1.5.0", "1.4.0")).toBe(false);
      expect(isNewerVersion("1.0.5", "1.0.4")).toBe(false);
    });

    test("handles missing patch version", () => {
      expect(isNewerVersion("1.0", "1.0.1")).toBe(true);
      expect(isNewerVersion("1.0.1", "1.0")).toBe(false);
    });

    test("handles complex version comparisons", () => {
      expect(isNewerVersion("1.9.9", "1.10.0")).toBe(true);
      expect(isNewerVersion("1.10.0", "1.9.9")).toBe(false);
      expect(isNewerVersion("0.99.99", "1.0.0")).toBe(true);
    });
  });

  describe("Package constants", () => {
    test("CURRENT_VERSION is a valid semver", () => {
      expect(CURRENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("PACKAGE_NAME is defined", () => {
      expect(PACKAGE_NAME).toBeDefined();
      expect(typeof PACKAGE_NAME).toBe("string");
      expect(PACKAGE_NAME.length).toBeGreaterThan(0);
    });
  });
});

