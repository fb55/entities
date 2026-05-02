# Security Policy

## Supported Versions

Only the latest major release receives security updates. Please make sure to update to the latest release before reporting issues.

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

To report a security vulnerability, use the
[Tidelift security contact](https://tidelift.com/security). Tidelift will
coordinate the fix and disclosure.

If Tidelift doesn't respond, you can also report vulnerabilities via
[GitHub's private vulnerability reporting](https://github.com/fb55/entities/security/advisories/new).

## Threat Model

`entities` is a pure-JavaScript library for encoding and decoding HTML/XML
character entities. It performs no I/O, spawns no subprocesses, and has no
runtime dependencies. Inputs are untrusted strings; outputs are strings.

Security issues we are particularly interested in:

- **Denial of service** — crafted input that causes excessive CPU or memory
  usage in `decode*` or `encode*` functions (e.g., quadratic behavior, runaway
  allocations).
- **Incorrect decoding that enables XSS downstream** — cases where the decoder
  produces output that misrepresents the input in a way that could let an
  attacker smuggle markup through a consumer's sanitizer.
- **Incorrect encoding** — cases where `encode*` fails to escape a character
  that, when emitted into HTML/XML, would break out of its context.
- **Supply chain** — compromised release artifacts, build pipeline, or
  maintainer accounts.

### Out of Scope

- Vulnerabilities in applications that use `entities` output without
  appropriate context-aware sanitization. This library decodes/encodes
  entities; it is not an HTML sanitizer.
- Behavior that matches the [WHATWG HTML named character reference
  spec](https://html.spec.whatwg.org/multipage/parsing.html#character-reference-state),
  even if surprising. Spec deviations are bugs and may be security-relevant;
  spec-conformant quirks generally are not.
- Social engineering attacks against maintainers.
