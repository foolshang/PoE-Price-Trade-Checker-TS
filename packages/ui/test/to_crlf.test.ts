/** the line ends of the filter file the page hands over (dom.ts toCrlf, used by writeToFolder and the download) */
import { describe, expect, it } from "vitest";
import { toCrlf } from "../src/dom.ts";

describe("toCrlf", () => {
  it("never doubles a CR", () => {
    expect(toCrlf("A\nB\n# ===== base filter below =====\nx\r\ny\n")).toBe("A\r\nB\r\n# ===== base filter below =====\r\nx\r\ny\r\n");
  });
  it("text without line ends is unchanged", () => expect(toCrlf("abc")).toBe("abc"));
});
