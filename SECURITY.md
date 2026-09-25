# Security policy

## Scope

This repository contains the Toolars evidence harness and two local Node
packages (`@toolars/cli`, `@toolars/local-tools`). It does not contain the
Toolars website or its tool runtimes.

In scope:

- the harness reading or transmitting data it should not;
- the CLI or MCP server sending input, results, or telemetry off the machine;
- a reported claim in this repository that the code does not actually keep
  (for example, a documented "no network" path that makes a request).

## Reporting

Email **contact@toolars.com** with a description, the affected file or command,
and the smallest reproduction you can manage. Please do not open a public issue
for anything exploitable before it is fixed.

This is a solo-maintained project. There is no bug bounty, no guaranteed
response time, and no support contract attached to this repository. What you
will get is an honest answer: either a fix, or an explanation of why the
behaviour is intended and the documentation needs correcting instead.

## What is already public

The website publishes its own runtime privacy declarations, the list of
external hosts the site shell can reach, and the served security headers at
<https://toolars.com/privacy-proof>. The site does not send a site-wide
Content-Security-Policy, and it says so there rather than implying otherwise.

## Out of scope

- Denial of service against the website.
- Reports that a local tool can be made to crash on malformed input, unless the
  failure crosses a boundary the documentation claims it does not (for example,
  input leaving the browser).
- Automated scanner output without a reproduction.
