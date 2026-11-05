# Security policy

LGPDer decides whether trackers may run on a page, so a flaw that grants consent without an explicit action of the data subject, keeps a tracker running after a revocation or leaks data is treated as a security issue.

## Supported versions

Until 1.0, security fixes are released only for the latest published version (`0.x`) and applied to the `main` branch.

## Reporting a vulnerability

Please do **not** report security vulnerabilities through public issues, pull requests or discussions.

Report them privately through GitHub: open the repository's [Security tab](https://github.com/azevedo1z/LGPDer/security) and select **Report a vulnerability**.

Include as much of the following as possible:

- The affected subpath (for example `lgpder/storage`, `lgpder/scripts`, `lgpder/ui`)
- The type of issue and its potential impact (consent granted without action, tracker not blocked or not stopped, XSS, data sent somewhere)
- Steps to reproduce, or a proof of concept
- The version or commit you tested against

Remove real personal data from your report.

## What to expect

- An acknowledgement of your report as soon as possible.
- An assessment of the issue and, when confirmed, a fix on `main` and a patch release.
- Credit in the fix announcement, unless you prefer to remain anonymous.

Please give the maintainers reasonable time to release a fix before disclosing the issue publicly.
