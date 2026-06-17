/**
 * Mock authentication middleware.
 *
 * Real auth (JWT/session) is out of scope for these questions — what matters is
 * that downstream handlers receive a `req.user`. This reads the caller's id from
 * the `x-user-id` header so tests can easily impersonate different users (e.g.
 * to demonstrate IDOR in Q5: log in as user A, request user B's resource).
 *
 * IMPORTANT for Q5: `auth` proves you are *a* user, not that you are *that*
 * user. It deliberately does NOT check ownership — that's the planted bug to
 * find.
 */
export function auth(req, res, next) {
  const id = req.header('x-user-id');
  if (!id) return res.status(401).json({ error: 'unauthenticated' });
  req.user = { id, role: req.header('x-user-role') || 'user' };
  next();
}
