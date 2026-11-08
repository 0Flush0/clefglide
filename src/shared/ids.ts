/**
 * Opaque identifiers for local records, exercise seeds and UI elements only.
 *
 * This deliberately does not depend on Web Crypto or a secure origin. A
 * per-page nonce reduces collisions across tabs/reloads; the monotonic suffix
 * guarantees distinct calls within this module even with a fixed clock/random
 * source. Cross-page uniqueness is probabilistic, sufficient for local data.
 *
 * Never use these IDs for tokens, credentials, authorization or secrets. Those
 * must use secure cryptographic randomness and fail if it is unavailable.
 */
const pageNonce = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
let sequence = 0;

export function createLocalId(
  purpose: "session" | "exercise" | "ui" = "ui",
): string {
  sequence += 1;
  return `${purpose}-${Date.now().toString(36)}-${pageNonce}-${sequence.toString(36)}`;
}
