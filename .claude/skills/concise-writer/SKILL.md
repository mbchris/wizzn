---
name: concise-writer
description: >
  MANDATORY for all Markdown file operations.
  Enforces strict brevity and high information
  density. Removes filler, meta-talk, and bloat.
inference_examples:
  - "Edit README.md"
  - "Update documentation"
  - "Write a new markdown file"
  - "Modify CLAUDE.md or AGENTS.md"
  - "Generate instruction files"
  - "Add a section to the docs"
  - "Write best practices"
---

# Concise Writing Protocol

**Goal**: Maximize signal-to-noise ratio.
**Audience**: Senior Developers & AI Agents.

### 1. The "No Meta-Talk" Rule
- **Forbidden**: "Here is the code you asked for", "I have updated the file", "Let me know if you need more help", "Certainly!".
- **Required**: Start directly with the answer/code/artifact.

### 2. Documentation Style (Anti-Bloat)
When writing docs (README, ADRs, Context):
- **Use Lists**: Bullet points > Paragraphs.
- **Use Tables**: For properties, env vars, and status.
- **No Tutorials**: Don't explain *how* code works, explain *why* decisions were made.
- **Passive Voice**: Avoid "We decided to use..." -> Use "Decision: Use...".

### 3. Code Comments
- **Forbidden**: Comments that repeat variable names (e.g., `// set id`).
- **Required**: Comments only for "Why" (e.g., `// specific workaround for API latency`).

### 4. Response Structure
- **Answer First**: The solution must be in the first 2 lines.
- **Context Later**: Details follow only if strictly necessary.

### Example Correction
- **Bad**: "In order to ensure that the database connection is secure, we need to set the SSL mode."
- **Good**: "Set `ssl-mode: verify-full` for security."

### Anti-Patterns

- Adding "Here is..." or "Let me..." preambles.
- Writing paragraphs where bullets or tables are
  clearer.
- Explaining how code works instead of why a
  decision was made.
- Writing comments that just restate names.

### Common Rationalizations

| Excuse | Why it fails |
|--------|-------------|
| "Context helps the reader" | Context that hides the answer delays the reader instead of helping. |
| "Being thorough is better than being brief" | Extra words usually dilute the decision or instruction. |
| "Paragraphs read more naturally" | In docs and rules, scanability beats conversational flow. |
| "One more sentence won't hurt" | Repeated small additions are how instruction bloat starts. |
| "Beginners need more explanation" | Good structure beats filler for both beginners and experts. |
