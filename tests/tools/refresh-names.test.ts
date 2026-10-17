import { describe, expect, it } from "vitest";
import { mayWrite } from "../../tools/refresh-names.ts";

describe("names:refresh guard", () => {
  it("writes a list that grew, stayed, or shrank by at most 20%", () => {
    expect(mayWrite(1200, 1000)).toBe(true);
    expect(mayWrite(1000, 1000)).toBe(true);
    expect(mayWrite(800, 1000)).toBe(true);
  });
  it("refuses a list that shrank by more than 20%", () => {
    expect(mayWrite(799, 1000)).toBe(false);
    expect(mayWrite(10, 1000)).toBe(false);
  });
  it("refuses an empty list, but accepts the first one when nothing is shipped", () => {
    expect(mayWrite(0, 1000)).toBe(false);
    expect(mayWrite(0, 0)).toBe(false);
    expect(mayWrite(5, 0)).toBe(true);
  });
});
