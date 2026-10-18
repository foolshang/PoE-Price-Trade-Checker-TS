import { describe, expect, it } from "vitest";
import { testEnv } from "../../packages/desktop/src/test_env.ts";

describe("test-only environment variables", () => {
  it("count only together with POE_CHECKER_TEST=1", () => {
    expect(testEnv("POE_UPDATE_FEED", { POE_UPDATE_FEED: "http://x" })).toBeUndefined();
    expect(testEnv("POE_UPDATE_FEED", { POE_UPDATE_FEED: "http://x", POE_CHECKER_TEST: "0" })).toBeUndefined();
    expect(testEnv("POE_UPDATE_FEED", { POE_UPDATE_FEED: "http://x", POE_CHECKER_TEST: "1" })).toBe("http://x");
    expect(testEnv("POE_UPDATE_FEED", { POE_CHECKER_TEST: "1" })).toBeUndefined();
    expect(testEnv("POE_UPDATE_FEED", { POE_UPDATE_FEED: "", POE_CHECKER_TEST: "1" })).toBeUndefined();
  });
});
