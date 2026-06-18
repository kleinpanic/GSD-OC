---
name: gsd-blocklist-fixture
description: Block-list tools-form fixture (gsd-security-auditor shape) for the parser.
tools:
  - Read
  - Write
  - Bash
color: red
effort: xhigh
---

<role>
Block-list-form fixture body. The two real block-list agents (gsd-security-auditor,
gsd-nyquist-auditor) use this YAML list shape and must NOT parse to an empty allowlist.
</role>
