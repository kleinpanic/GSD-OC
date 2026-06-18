---
name: gsd-csv-fixture
description: CSV tools-form fixture for the port-agents parser.
tools: Read, Write, Bash, mcp__context7__*
color: yellow
effort: high
---

<role>
CSV-form fixture body. The parser must read everything after the closing frontmatter
delimiter as the verbatim prompt.
</role>

Line with a literal backtick ` and a template marker ${notInterpolated} to prove the
generator escapes inlined prompt bodies.
