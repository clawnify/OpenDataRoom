/**
 * Link access gates, kept pure so they are testable: everything here is the
 * trust boundary between "someone holds the URL" and "someone may read the
 * document", so the rules live in one place and nowhere else.
 */

export interface LinkGate {
  is_active: number;
  expires_at: string | null;
  require_email: number;
  passcode_hash: string;
  /** Whitespace/comma-separated emails or @domains. Non-empty = only these may enter. */
  allow_list?: string;
  /** Same format; matches are refused. Deny wins over allow. */
  deny_list?: string;
  /** Text the viewer must accept before entering; empty = no agreement gate. */
  agreement_text?: string;
}

export type GateVerdict =
  | { ok: true; email: string }
  | { ok: false; status: 404 | 410 | 401 | 403 | 412 | 422; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** SHA-256 hex — used for passcodes. WebCrypto, so it runs in Workers and Node. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 72 bits of randomness, base62 — the public link token. */
export function makeLinkToken(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += alphabet[b % 62];
  return out;
}

/**
 * Parse an allow/deny list: entries split on commas/whitespace/newlines.
 * An entry with "@" followed by more text is an exact email; an entry that is
 * just "@domain.com" or "domain.com" matches every address at that domain.
 */
export function matchesList(list: string | undefined, email: string): boolean {
  if (!list?.trim() || !email) return false;
  const domain = email.split("@")[1] ?? "";
  for (const raw of list.toLowerCase().split(/[\s,]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.includes("@") && !entry.startsWith("@")) {
      if (entry === email) return true;
    } else if (entry.replace(/^@/, "") === domain) {
      return true;
    }
  }
  return false;
}

/**
 * Decide whether a viewer may open a link. `now` is injected for tests.
 * Order matters: a disabled or expired link answers the same regardless of
 * what the caller supplied, so those checks come before the credential ones.
 */
export async function evaluateGate(
  link: LinkGate | null | undefined,
  input: { email?: string; passcode?: string; agreed?: boolean },
  now: Date = new Date(),
): Promise<GateVerdict> {
  if (!link) return { ok: false, status: 404, error: "This link does not exist." };
  if (!link.is_active) return { ok: false, status: 410, error: "This link has been deactivated." };
  if (link.expires_at && now.getTime() > Date.parse(link.expires_at + (link.expires_at.endsWith("Z") ? "" : "Z"))) {
    return { ok: false, status: 410, error: "This link has expired." };
  }

  const email = (input.email ?? "").trim().toLowerCase();
  const hasAllowList = !!link.allow_list?.trim();
  // An allow list implies identification: without an email there is nothing to
  // check the list against, so the email gate turns on with it.
  if ((link.require_email || hasAllowList) && !EMAIL_RE.test(email)) {
    return { ok: false, status: 422, error: "Enter a valid email address to view this document." };
  }
  if (email && matchesList(link.deny_list, email)) {
    return { ok: false, status: 403, error: "This link is not available for your email address." };
  }
  if (hasAllowList && !matchesList(link.allow_list, email)) {
    return { ok: false, status: 403, error: "This link is not available for your email address." };
  }

  if (link.passcode_hash) {
    const supplied = (input.passcode ?? "").trim();
    if (!supplied || (await sha256Hex(supplied)) !== link.passcode_hash) {
      return { ok: false, status: 401, error: "The passcode is incorrect." };
    }
  }

  if (link.agreement_text?.trim() && !input.agreed) {
    return { ok: false, status: 412, error: "Accept the agreement to view this document." };
  }

  return { ok: true, email };
}
