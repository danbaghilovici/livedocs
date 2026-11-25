# Project configuration

Use `realdocs.json` to give a project a shared documentation homepage and group code and Markdown guides into sections. Each section can use its own TypeScript configuration.

## Generate a starter config

Run `npx realdocs init` from the directory you want to document. It uses TypeScript configs and project references, package metadata, and entries such as `main.ts` and `index.ts` to suggest sections. It can also use `nest-cli.json` when present. A section can cover an app, a shared library, or a set of guides. Edit the generated config to match how readers should navigate the project.

`init` also discovers Markdown files. It assigns guides inside a discovered section to that section and lists unassigned guides under the top-level `pages` field. For example, a root `ARCHITECTURE.md` appears as a guide. Use `npx realdocs init --print` to preview discovery without writing a file. Once the config exists, edit it directly.

After generating or editing the config, use the usual commands.

```sh
npx realdocs check --strict
npx realdocs build --format html --graph
```

Subsequent builds use the saved list of entries and pages. Add new files to the config when you want them to appear in the wiki.

With a config present, `--page` adds a root guide for that run. Use `--entry` or `--project` to run with explicit inputs. `watch` uses explicit `--entry` or `--page` inputs. [CLI usage](../README.md#commands)

## Example `realdocs.json`

Paths are relative to the directory containing `realdocs.json`.

```json
{
  "pages": ["README.md", "ARCHITECTURE.md"],
  "sections": {
    "orders": {
      "title": "Orders API",
      "project": "services/orders/tsconfig.json",
      "entries": ["services/orders/src/main.ts", "services/orders/src/orders.ts"],
      "pages": ["services/orders/docs/operations.md"]
    },
    "contracts": {
      "title": "Shared contracts",
      "project": "packages/contracts/tsconfig.json",
      "entries": ["packages/contracts/src/index.ts"]
    }
  }
}
```

| Field | Purpose |
| --- | --- |
| Top-level `pages` | Markdown guides linked from the wiki homepage. |
| `sections` | Named groups of source files and guides. Each key identifies a section in the wiki. Use lowercase letters, digits, hyphens, and underscores, starting with a letter or digit. |
| `sections.<id>.title` | Optional display name. The section ID is the default. |
| `sections.<id>.project` | Optional path to a compiler config for this section. It supplies compiler settings and path aliases. If omitted, RealDocs uses the root `tsconfig.json` or `jsconfig.json` when available. |
| `sections.<id>.entries` | JavaScript or TypeScript files selected for documentation. |
| `sections.<id>.pages` | Markdown guides linked from the section's landing page. |

## Homepage and Mermaid C4 diagrams

RealDocs generates the homepage from the project name, section links, and guide links. The project name comes from `package.json` or the directory name. `--graph` adds a file map to the homepage and each section landing page. A section map covers its selected files and their source dependencies. Every selected Markdown guide has its own page, including any root README or architecture guide. Shared source pages have one URL so multiple sections can link to them.

Put Mermaid `C4Context` and `C4Container` diagrams in a guide linked from the homepage. Put focused `C4Component` diagrams in a section guide or a source file overview. The diagrams describe the runtime architecture. The file map shows code relationships derived from the source. [Code-linked diagrams](../README.md#code-linked-diagrams) · [Mermaid C4 syntax](https://mermaid.js.org/syntax/c4.html)
