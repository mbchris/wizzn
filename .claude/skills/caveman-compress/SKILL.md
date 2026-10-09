---
name: caveman-compress
description: >
  Compress natural language files (CLAUDE.md,
  todos, preferences) into caveman format to save
  input tokens. Preserves all technical substance,
  code, URLs, structure. Overwrites original;
  backup saved as FILE.original.md.
  Trigger: /caveman-compress FILEPATH or
  "compress memory file".
inference_examples:
  - "/caveman-compress"
  - "compress memory file"
  - "compress this markdown"
  - "shrink CLAUDE.md"
---

# Caveman Compress

## Purpose

Compress natural language files (CLAUDE.md, todos,
preferences) into caveman-speak to reduce input
tokens. Compressed version overwrites original.
Human-readable backup saved as
`<filename>.original.md`.

## Trigger

`/caveman-compress <filepath>` or when user asks
to compress a memory file.

## Compression Rules

### Remove
- Articles: a, an, the
- Filler: just, really, basically, actually,
  simply, essentially, generally
- Pleasantries: "sure", "certainly", "of course",
  "happy to", "I'd recommend"
- Hedging: "it might be worth", "you could
  consider"
- Redundant phrasing: "in order to" → "to",
  "make sure to" → "ensure"
- Connective fluff: "however", "furthermore",
  "additionally"

### Preserve EXACTLY (never modify)
- Code blocks (fenced and indented)
- Inline code (`backtick content`)
- URLs and links
- File paths
- Commands (`npm install`, `git commit`)
- Technical terms (library names, API names)
- Proper nouns
- Dates, version numbers, numeric values
- Environment variables

### Preserve Structure
- All markdown headings (keep exact heading text,
  compress body below)
- Bullet point hierarchy
- Numbered lists
- Tables (compress cell text, keep structure)
- Frontmatter/YAML headers

### Compress
- Short synonyms: "big" not "extensive"
- Fragments OK: "Run tests before commit"
- Drop "you should", "make sure to" — just state
  action
- Merge redundant bullets
- Keep one example where multiple show same
  pattern

CRITICAL: Anything inside ``` ... ``` must be
copied EXACTLY. Inline code (`...`) preserved
EXACTLY. If file contains code blocks, treat as
read-only regions — only compress text outside.

## Pattern

Original:
> You should always make sure to run the test
> suite before pushing any changes to the main
> branch.

Compressed:
> Run tests before push to main. Catch bugs
> early, prevent broken prod deploys.

## Boundaries

- ONLY compress natural language files
  (.md, .txt, .typ, .typst, .tex, extensionless)
- NEVER modify: .py, .js, .ts, .json, .yaml,
  .yml, .toml, .env, .lock, .css, .html
- Mixed content: compress ONLY prose sections
- If unsure code vs prose, leave unchanged
- Never compress FILE.original.md (skip it)
