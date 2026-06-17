/**
 * Q3 — Mock "send welcome email" side effect.
 *
 * In the real system this would call an email provider (SES / SendGrid / Postmark).
 * Here it just resolves after a microtask. It is built to be TESTABLE so the scenario
 * tests can prove two things about the fixed router:
 *
 *   (a) BOUNDED CONCURRENCY — `maxConcurrent` records the high-water mark of how many
 *       calls were in flight simultaneously. The test asserts this never exceeds the
 *       router's configured limit.
 *
 *   (b) PARTIAL FAILURE — `failFor(email)` marks an address so the next send to it
 *       rejects. This lets a test prove that one bad row does not sink the whole batch
 *       and shows up in the `failed` report.
 *
 * The hooks are module-level (simple on purpose). Tests import these named exports,
 * call `resetEmailHooks()` in beforeEach, configure as needed, then read the counters.
 */

// High-water mark of concurrent in-flight sends since the last reset.
let maxConcurrent = 0;
// Current number of in-flight sends.
let inFlight = 0;
// Total number of successful sends since the last reset.
let sent = 0;
// Set of emails (lowercased) that should cause the next send to fail.
const failEmails = new Set();
// Optional artificial delay (ms) per send, so concurrency is observable in tests.
let delayMs = 0;

/**
 * Send a welcome email. Resolves on success, rejects if the email was marked via
 * `failFor`. Tracks concurrency so tests can assert the in-flight cap.
 */
export async function sendWelcomeEmail(email) {
  inFlight++;
  if (inFlight > maxConcurrent) maxConcurrent = inFlight;
  try {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } else {
      // Yield once so concurrent calls actually overlap rather than running to
      // completion synchronously in a single microtask.
      await Promise.resolve();
    }
    if (failEmails.has(String(email).toLowerCase())) {
      throw new Error(`email provider rejected ${email}`);
    }
    sent++;
  } finally {
    inFlight--;
  }
}

// ---- Test hooks --------------------------------------------------------------

/** Reset all counters and configured failures. Call in test beforeEach. */
export function resetEmailHooks() {
  maxConcurrent = 0;
  inFlight = 0;
  sent = 0;
  failEmails.clear();
  delayMs = 0;
}

/** Mark an email so its next send rejects. */
export function failFor(email) {
  failEmails.add(String(email).toLowerCase());
}

/** Add an artificial per-send delay so overlap is observable. */
export function setEmailDelay(ms) {
  delayMs = ms;
}

/** High-water mark of concurrent in-flight sends. */
export function getMaxConcurrent() {
  return maxConcurrent;
}

/** Count of successful sends. */
export function getSentCount() {
  return sent;
}
