---
name: create-seeya-concept
description: >
  Create a SeeYa concept page in Confluence under
  the "Seeya Concepts" folder. Use when the user
  asks to write/create/publish a concept, spin up
  a concept page from a story or ticket, or draft
  a concept for a topic like ETC or ETW. Works
  from session context, a story link, or by
  asking the user for the necessary details.
inference_examples:
  - "Create a concept page for this"
  - "Write a concept for story 117502"
  - "Publish this as a SeeYa concept"
  - "Spin up a concept for what we just discussed"
  - "Turn this into a concept"
  - "New concept in Confluence"
  - "Create an ETW concept for the runner changes"
  - "Create concept for ticket #118131"
  - "Draft a concept page from this session"
  - "Make a concept for what we talked about"
  - "Concept page pls"
  - "SeeYa concept for [topic]"
---

# Create SeeYa Concept

Create a new SeeYa concept page in Confluence under the **Seeya Concepts** folder, following the team's conventions and using the **Concepts Page Template** as the starting point.

## Confluence references (source of truth)

- **Folder**: [Seeya Concepts](https://{{CONFLUENCE_DOMAIN}}/wiki/spaces/{{SPACE}}/folder/{{FOLDER_ID}}/Seeya+Concepts)
  id `{{FOLDER_ID}}`, space `{{SPACE}}`
- **Conventions page**: [Concept Conventions](https://{{CONFLUENCE_DOMAIN}}/wiki/spaces/{{SPACE}}/pages/{{CONVENTIONS_PAGE_ID}}/Concept+Conventions)
  id `{{CONVENTIONS_PAGE_ID}}`
- **Template page**: [Concepts Page Template](https://{{CONFLUENCE_DOMAIN}}/wiki/spaces/{{SPACE}}/pages/{{TEMPLATE_PAGE_ID}}/Concepts+Page+Template)
  id `{{TEMPLATE_PAGE_ID}}`

**Sub-folders** (children of the root folder):

| Sub-folder | id | Use for |
|---|---|---|
| **General Concepts** | `{{GENERAL_FOLDER_ID}}` | Cross-product or product-agnostic concepts |
| **ETC** | `{{ETC_FOLDER_ID}}` | ETC-specific concepts |
| **ETW** | `{{ETW_FOLDER_ID}}` | ETW-specific concepts |

If a concept spans multiple products, place it in **General Concepts**.

---

## Step 0 — Verify Confluence access

This skill **requires the agent to be able to read from and write to Confluence**. The skill does **not** prescribe *how* — that depends on the user's setup.

**Check access in this order, do not skip steps:**

1. **MCP tools.** Look for an `mcp__confluence__*` (or similar) tool in your available tools.
2. **Available-skills list.** Look at the skills available in the current session. If a `confluence` skill (or similar, e.g. `wiki`) is listed, **load it and follow its instructions to connect**. **Do not conclude "no access" before doing this check.**
3. **Documented alternative.** Check user / AGENTS.md / workspace notes for a documented REST API + PAT pattern.

Only after **all three** checks come up empty:

> ⚠️ **STOP. Tell the user prominently:**
>
> "This skill needs Confluence access. I checked MCP tools, the available-skills list, and documented API access and found none. Please configure Confluence connectivity (e.g. enable a Confluence MCP server, load a `confluence` skill, or document a PAT + REST approach) and re-run."
>
> **Do not attempt to fabricate the page, do not write local Markdown as a stand-in, do not ask the user to copy/paste HTML.** Just stop and inform.

---

## Step 1 — Read the source-of-truth pages

Using whatever Confluence access is available, fetch the **storage body** of:

1. **Concept Conventions** (`3139962382`) — to learn title format, folder rules, resource-and-links rules, and any other conventions that have been added.
2. **Concepts Page Template** (`3139286595`) — to get the exact page body to copy.

Both pages are the source of truth. Do not hard-code the structure into the skill — always read them.

If either fetch fails, surface the error and stop.

---

## Step 2 — Determine the concept topic and target folder

Gather what the concept is about. Three possible ways, in priority order:

### (a) Use session context, if present
If the current conversation has been about a concept (e.g. the user has been refining an idea, brainstorming an approach, drafting a solution), treat that as the **Concept** body. Extract a meaningful title from the discussion and identify the relevant story number, if one was referenced.

### (b) Resolve context from a ticket link or ID
If the user provided a story or issue link / ID (GitHub, issue tracker, etc.):
- Read the story via available tools (MCP, CLI, issue tracker, etc.).
- Use the story's title, description, and acceptance criteria to pre-fill the **Concept Goal** and **Concept** sections.
- Populate **Ressources & Links** with a link to the story.

If neither ticket access nor story data is available, fall back to (c).

### (c) No context — ask the user
If neither (a) nor (b) applies, ask the user. Offer two modes:

- **Provide details**: ask for topic, story number, goal, and a sketch of the concept. Use the answers to fill the template.
- **Placeholder**: offer to create a mostly-empty copy of the template that they will fill in themselves. In this case the user only needs to give a **story ID, a story link, or a page title** — everything else can stay as the template placeholders.

Offer both options and let the user choose.

---

## Step 3 — Choose the target folder

Pick the sub-folder based on product scope:

| The concept is about… | Use |
|---|---|
| ETW (test runner, workflows, executions) | `ETW` folder |
| ETC (test configuration, BROP, config sync) | `ETC` folder |
| IDC, multiple products, or product-agnostic | `General Concepts` folder |

If unsure, ask the user. Do not guess between ETC and ETW if the topic is ambiguous.

---

## Step 4 — Build the page

1. **Title** must follow the convention from the conventions page:
   ```
   [<date or sprint>] <page-title> - #<story-nr>
   ```
   If no story number exists (e.g. a pure placeholder), ask the user whether to omit the bracket or use a placeholder like `[TBD]`.

2. **Body** must be a faithful copy of the **Concepts Page Template** body storage, with the placeholders filled in:

   - **Status badges**: keep exactly one. Remove the others. Default to **Draft** unless the user specifies otherwise.
   - **Ressources & Links**:
     - `Story:` — link to the story (issue / work item URL).
     - `Related:` — link related concepts, tickets, Murals, etc., or leave as `none`.
   - **Concept Goal**: fill from context or user input. If unknown, keep the placeholder italic text.
   - **Concept**: fill from context or user input. If unknown, keep the placeholder italic text.
   - **Open Questions**: list any open questions surfaced in the session, else `<none>`.
   - **Decision / Outcome**: leave as `<To be filled after discussion>` unless explicitly told otherwise.

3. **Preserve macros and layout**. The template uses `<ac:layout>`, `<ac:structured-macro>` (TOC + status badges) and `<ac:link>` markup. Only modify the placeholders and badge selection — do not restructure.

4. **Hyphens, not em-dashes**. Use plain ASCII hyphens (`-`) for separators in titles, headings, and body text. **Do not** use em-dash (`—`) or en-dash (`–`) characters, and do not use the `&mdash;` / `&ndash;` HTML entities either — Confluence auto-converts both into real em-dashes at render time, which the user has asked to avoid. If you find yourself writing `Foo — Bar`, write `Foo - Bar` (or `Foo: Bar` if a colon reads better).

---

## Step 5 — Create the page in Confluence

Create the page as a child of the chosen target folder:

- Parent for `General Concepts`: `3139864108`
- Parent for `ETC`: `3139286250`
- Parent for `ETW`: `3139962311`

After creating:

1. Print the page URL and ID to the user.
2. Confirm which folder it went into.
3. Confirm the title and status badge that were used.
4. Suggest next steps (e.g. share in the team channel, link it from the story).

Do **not** save a local copy of the page content. Confluence is the source of truth.

---

## Step 6 — Reflect any structural changes back

If, while reading the conventions or template, you notice the structure has changed (new folder, new section, new convention), mention it to the user. Do not silently handle drift.

---

## Anti-patterns — do **not** do these

- ❌ Fabricating the page locally as Markdown and telling the user to "paste it in" — if there is no Confluence access, stop and inform (see Step 0).
- ❌ Skipping the read of the conventions/template pages and using cached structure from a previous session — always re-read, they may have been updated.
- ❌ Guessing the target folder when the product scope is unclear — ask.
- ❌ Stripping macros or `<ac:layout>` from the template body.
- ❌ Keeping multiple status badges — exactly one must remain.
- ❌ Hard-coding the recent template structure into the skill body — read it fresh each time.
- ❌ Creating the page at the SeeYa Concepts root level — always pick a sub-folder.
