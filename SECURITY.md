# Security Policy

## Supported Versions

NoteBi is currently pre-1.0 local-first software. Security fixes target the latest `main` branch unless a maintainer announces a tagged release line.

## Reporting a Vulnerability

Please do not open a public issue for vulnerabilities.

Use GitHub private vulnerability reporting when available:

Use the Security Advisories page of the NoteBi GitHub repository after it is published.

If that is unavailable, open a minimal public issue asking for a private contact path. Do not include exploit details, secrets, or private user data in the issue.

## Sensitive Data Expectations

NoteBi should not require committing or sharing:

- API keys
- Cookies or browser session data
- Downloaded media
- Local databases
- User workspace content
- Model caches or generated runtime files

If you find a path that writes these into tracked files or logs them unexpectedly, report it as a security issue.
