# Importing Curated Skill Packs (agentskills.io standard)

Ultimatrix skills use the same structural convention as the [agentskills.io](https://agentskills.io)
open standard: a folder (or flat file) with YAML frontmatter + markdown body,
optionally a `refs/` subfolder for deep-dive references. That means curated
third-party security skill libraries can be imported without code changes.

## What imports cleanly

A pack works when each skill is either:

- `<dir>/<skill-name>.md` — frontmatter + body, or
- `<dir>/<skill-name>/SKILL.md` (+ optional `<dir>/<skill-name>/refs/*.md`)

Required frontmatter: `name`, `description`. Recognized extras: `toolRefs`,
`primitives`, `triggers`, `tier`, `domain`, `category`.

## The validation gate (applies to every import)

Every import — CLI, web, or in-conversation via `manageSkills` — is rejected
unless ALL of the following hold:

1. Frontmatter present and parseable; `name` and `description` non-empty
2. Folder/file name equals the frontmatter `name`
3. Every `toolRefs` entry exists in the tool registry
4. Every `primitives` entry exists in the primitive registry
5. At least one NON-EMPTY fenced block (payload-stripped skills are rejected)
6. All fences closed; file ≤ 256 KB

## CLI

```bash
ultimatrix skills list                    # bundled vs imported
ultimatrix skills add ./my-skill.md       # single file
ultimatrix skills add ./my-pack/skills/   # directory (SKILL.md per subfolder)
ultimatrix skills add /tmp/ctf-crypto.md  # any agentskills.io-compatible file
ultimatrix skills remove user/<name>
```

Imports land under `<workspace>/<target>/skills-user/` and are namespaced
`user/<name>`. The index hot-reloads — no restart.

## Web

`POST /api/skills` with `{ "markdown": "..." }` or `{ "path": "/server/local/path" }`.
`DELETE /api/skills?id=user/<name>` to remove. The settings panel lists
bundled vs imported skills.

## In conversation

Paste skill content and ask the agent to import it — it calls the same
validated path through its `manageSkills` capability.

## Known-good third-party packs

Libraries published against the agentskills.io standard with MITRE ATT&CK
mappings (e.g. community cybersecurity collections under Apache-2.0) import
as-is. Review every skill before promotion — imported content is DATA, never
instructions, but you are still responsible for what your agent loads.
