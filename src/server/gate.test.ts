import { describe, expect, it } from "vitest";
import { evaluateGate, makeLinkToken, matchesList, sha256Hex, type LinkGate } from "./gate";

const base: LinkGate = { is_active: 1, expires_at: null, require_email: 0, passcode_hash: "" };

describe("evaluateGate", () => {
  it("rejects a missing link as 404", async () => {
    expect(await evaluateGate(null, {})).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects a deactivated link as 410 before checking credentials", async () => {
    const verdict = await evaluateGate({ ...base, is_active: 0, require_email: 1 }, { email: "a@b.co" });
    expect(verdict).toMatchObject({ ok: false, status: 410 });
  });

  it("rejects an expired link and accepts one not yet expired", async () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const expired = await evaluateGate({ ...base, expires_at: "2026-08-14 09:00:00" }, {}, now);
    expect(expired).toMatchObject({ ok: false, status: 410 });
    const alive = await evaluateGate({ ...base, expires_at: "2026-08-16 09:00:00" }, {}, now);
    expect(alive).toMatchObject({ ok: true });
  });

  it("requires a plausible email when the link says so, and normalizes it", async () => {
    const link = { ...base, require_email: 1 };
    expect(await evaluateGate(link, {})).toMatchObject({ ok: false, status: 422 });
    expect(await evaluateGate(link, { email: "not-an-email" })).toMatchObject({ ok: false, status: 422 });
    expect(await evaluateGate(link, { email: "  Jane@Fund.VC " })).toEqual({ ok: true, email: "jane@fund.vc" });
  });

  it("checks the passcode against its hash", async () => {
    const link = { ...base, passcode_hash: await sha256Hex("open sesame") };
    expect(await evaluateGate(link, {})).toMatchObject({ ok: false, status: 401 });
    expect(await evaluateGate(link, { passcode: "wrong" })).toMatchObject({ ok: false, status: 401 });
    expect(await evaluateGate(link, { passcode: "open sesame" })).toMatchObject({ ok: true });
  });

  it("enforces both gates together", async () => {
    const link = { ...base, require_email: 1, passcode_hash: await sha256Hex("s3cret") };
    expect(await evaluateGate(link, { passcode: "s3cret" })).toMatchObject({ ok: false, status: 422 });
    expect(await evaluateGate(link, { email: "a@b.co" })).toMatchObject({ ok: false, status: 401 });
    expect(await evaluateGate(link, { email: "a@b.co", passcode: "s3cret" })).toEqual({ ok: true, email: "a@b.co" });
  });
});

describe("allow/deny lists", () => {
  it("matches exact emails and bare/@-prefixed domains", () => {
    expect(matchesList("jane@fund.vc", "jane@fund.vc")).toBe(true);
    expect(matchesList("jane@fund.vc", "john@fund.vc")).toBe(false);
    expect(matchesList("@fund.vc", "john@fund.vc")).toBe(true);
    expect(matchesList("fund.vc, other@x.co", "john@fund.vc")).toBe(true);
    expect(matchesList("fund.vc", "john@notfund.vc")).toBe(false);
    expect(matchesList("", "a@b.co")).toBe(false);
  });

  it("an allow list turns the email gate on and admits only matches", async () => {
    const link = { ...base, allow_list: "@fund.vc\npartner@lp.com" };
    expect(await evaluateGate(link, {})).toMatchObject({ ok: false, status: 422 });
    expect(await evaluateGate(link, { email: "stranger@gmail.com" })).toMatchObject({ ok: false, status: 403 });
    expect(await evaluateGate(link, { email: "Jane@Fund.VC" })).toEqual({ ok: true, email: "jane@fund.vc" });
    expect(await evaluateGate(link, { email: "partner@lp.com" })).toMatchObject({ ok: true });
  });

  it("deny wins over allow", async () => {
    const link = { ...base, require_email: 1, allow_list: "@fund.vc", deny_list: "jane@fund.vc" };
    expect(await evaluateGate(link, { email: "jane@fund.vc" })).toMatchObject({ ok: false, status: 403 });
    expect(await evaluateGate(link, { email: "john@fund.vc" })).toMatchObject({ ok: true });
  });
});

describe("agreement gate", () => {
  it("requires acceptance only when the link carries an agreement", async () => {
    const link = { ...base, agreement_text: "Keep this confidential." };
    expect(await evaluateGate(link, {})).toMatchObject({ ok: false, status: 412 });
    expect(await evaluateGate(link, { agreed: true })).toMatchObject({ ok: true });
    expect(await evaluateGate(base, {})).toMatchObject({ ok: true });
  });
});

describe("makeLinkToken", () => {
  it("makes 12-char URL-safe tokens that do not collide trivially", () => {
    const seen = new Set(Array.from({ length: 500 }, makeLinkToken));
    expect(seen.size).toBe(500);
    for (const t of seen) expect(t).toMatch(/^[0-9A-Za-z]{12}$/);
  });
});
