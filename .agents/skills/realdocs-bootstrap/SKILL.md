---
name: realdocs-bootstrap
description: Use when setting up RealDocs for the first time in an existing project, or creating its first coherent set of API documentation, architecture guides, and Mermaid C4 diagrams.
---

# First RealDocs documentation pass

Build a starter wiki from the project's current behavior. Preserve useful existing documentation and concentrate on what a new contributor or API consumer needs to get started.

## Identify what to document

1. Read the project's agent instructions, README, existing guides, and docs scripts. Inspect manifests, package exports, executable entry points, runtime and deployment configuration, and representative tests. Identify the intended readers, supported entry points, principal runtime units, and the project's main workflow.
2. Reuse the project's RealDocs version or docs script. If adopting RealDocs as a project dependency, use the project's package manager and Node.js 22 or later. Work from the directory that will own the wiki config.
3. Preview discovery with `npx realdocs init --print` and use it as a starting point for `realdocs.json`. Preserve an existing config and add the missing inputs. Check section `entries` against the actual JS/TS source entry points and `project` against each section's compiler config. Curate `pages` to include reader-facing guides. Keep agent instructions, generated output, and internal planning notes outside the wiki inputs. Use a Markdown-only `pages` config for projects without JS/TS API entries. With a CLI that predates `init`, record repeated `--page` and any `--entry` arguments in the project's docs command.

## Author the starter documentation

- Update an existing overview or add a short guide covering what the project does, how to start or use it, and where to find architecture and API details. Verify example commands against package scripts or tested workflows. Keep reliable prose and repair stale instructions and links in the selected guides.
- For the most important JS/TS exports, add or update JSDoc where readers need to understand behavior, inputs, results, errors, or a supported usage example. RealDocs extracts the signatures from source, so use comments to record facts the signature cannot express. Use `@realdocs:file` for an entry point's orientation when helpful. Preserve existing annotations and document public entry points without changing exports or runtime behavior to fill out the wiki.
- Create or refresh an architecture guide with Mermaid system context and container views for the verified runtime. Add a focused component view where it explains a concrete responsibility or interaction. Use the adjacent [`realdocs-c4` skill](../realdocs-c4/SKILL.md) for boundaries, aliases, syntax, `@realdocs:c4` markers, and code links. When an element is renamed or moved, update its `@realdocs:c4` markers too. If you have only this file, use the official references. [C4 abstractions](https://c4model.com/abstractions) · [Mermaid C4 syntax](https://mermaid.js.org/syntax/c4.html)
- Link wiki pages using paths relative to each source file. Include linked guides and API entry points in the wiki config. For a necessary reference to an internal file outside the wiki, use its repository URL. Replace stale or incidental internal links with relevant reader-facing content. Record uncertain runtime details as open questions. Keep proposed architecture separate from the current views.

## Verify and hand off

```sh
npx realdocs check --strict
npx realdocs build --strict --format html --out dist/realdocs-html
```

Use the project's docs script or pass matching explicit `--entry` and `--page` inputs when it uses those instead of `realdocs.json`. Open the generated homepage and follow the guide and symbol links. Confirm the expected exports appear, and check the rendered diagrams for readable labels and accurate relationships. Correct source JSDoc, guide, and config issues and rebuild. Keep changes in the authored files. Report the output path, the documentation added, and any remaining gaps or verification limits.

When the onboarding task includes setting up future agent instructions, add RealDocs' maintenance rule to the instruction file the project already uses. For a repo that uses `AGENTS.md`, run `npx realdocs install-skill --instructions-file AGENTS.md`. For Claude Code, use `--skills-dir .claude/skills --instructions-file CLAUDE.md`. Keep the rule in version control with the skills so future changes pick it up automatically.
