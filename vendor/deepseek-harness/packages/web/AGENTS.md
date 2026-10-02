# AGENTS.md — Web Packages

Maintenance authority: [WhaleIsle sole project policy](../../../../docs/maintenance/README.md). This file locates module contracts and mechanics; it cannot add independent maintenance gates, approvals or execution order.

These rules supplement the package conventions in [packages/AGENTS.md](../AGENTS.md).

- **Reject redirects on credential-bearing provider requests.** Configure the HTTP client to fail before following any redirect response. Regression coverage must prove that the redirect target is not contacted and that every credentialed provider opts into the policy. The configured endpoint necessarily receives the initial request; this prevents automatic forwarding of credentials or request data to another origin, not compromise of the configured endpoint.
