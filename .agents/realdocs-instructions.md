<!-- realdocs:maintenance:start -->
## Maintain project documentation

Review documentation for every feature, bug fix, or other code change. Update affected documentation in the same change as the code.

- Update JSDoc for changes to public contracts, behavior, inputs, outputs, errors, or usage examples. Update guides for changes to setup, configuration, operations, or user workflows.
- Update the affected Mermaid C4 diagrams and their accompanying text when runtime boundaries, responsibilities, integrations, protocols, or architectural relationships change. Use the `realdocs-c4` skill for diagram changes. When a C4 element is renamed or moved, update its alias in every view and the paths in its `@realdocs:c4` markers. Update RealDocs inputs and links when documented pages or entry points move, and retain stable `@realdocs:docId` values for renamed or moved exports.
- Verify changes with the project's documentation check, such as a package script that runs `realdocs check`. Use `npx realdocs check --strict` only when the project has none. With a suitable Git base and a CLI that supports it, `npx realdocs diff --base <ref>` can identify related docs to review. Build the HTML wiki and check rendering when diagrams change.

Before completing the task, report what documentation changed or why the existing documentation is still accurate. If the project has no documentation baseline, use the `realdocs-bootstrap` skill when setting up its first wiki.
<!-- realdocs:maintenance:end -->
