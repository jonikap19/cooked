# Rules

Binding for every change in this repo. Context: a small self-hosted web app for a handful of friends. Keep it simple, keep it safe.

## 1. Clean Code

- **Simplest thing that works.** No speculative features, abstractions, or config "for later" (YAGNI).
- **Reuse before writing.** Check the codebase, then the stdlib / platform, then already-installed deps. Add a new dependency only when it clearly beats a few lines of code.
- **Small, focused units.** One function = one job. One file = one concern. Prefer fewer files over deep folder trees.
- **Readable names.** Names say what a thing is/does; no abbreviations nobody would guess.
- **Boring over clever.** Code is read far more than written.
- **No dead code.** Delete unused code, commented-out blocks, and stale TODOs.
- **Comments explain *why*, not *what*.** Deliberate shortcuts get a `ponytail:` comment naming the limit and the upgrade path.
- **Consistent formatting.** Use the project's formatter/linter; don't hand-format.
- **Tests for real logic.** Non-trivial logic (branching, parsing, auth, money/data paths) gets at least one test that fails if it breaks. Trivial code needs none.

## 2. Secure Code

- **Never trust input.** Validate and sanitize everything crossing a trust boundary (request bodies, params, headers, uploads, env).
- **Secrets never in git.** Use env vars / secret stores; `.env*` is git-ignored. Rotate anything that leaked.
- **Auth on every non-public route.** Server-side checks only — never rely on the client to hide things.
- **Least privilege.** Users, tokens, and DB accounts get only the access they need.
- **Passwords:** hash with a modern slow hash (argon2id / bcrypt) — or better, avoid storing them (magic links / OAuth / platform auth).
- **Sessions:** `HttpOnly`, `Secure`, `SameSite` cookies; expire them; CSRF protection on state-changing requests.
- **Injection:** parameterized queries only; never build SQL/shell/HTML by string concatenation. Escape output by default.
- **HTTPS only.** Set sensible security headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors).
- **Dependencies:** few, maintained, pinned via lockfile; check for known vulnerabilities before adding/upgrading.
- **Errors:** log details server-side, show generic messages to users. Never log secrets or personal data.
- **Rate-limit** auth and other abuse-prone endpoints.
- **Run a security review** before merging anything touching auth, data access, or uploads.

## 3. Git Workflow

- `main` is always deployable. No direct feature work on `main`.
- Branch names: `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`, `docs/<short-desc>` (kebab-case).
- Commit small, coherent units with clear messages (imperative: "Add login form").
- Commit author email: **only** `180111101+jonikap19@users.noreply.github.com` (set in repo-local git config). Never commit with a personal email.
- Merge to `main` only when tests pass. Delete merged branches.
