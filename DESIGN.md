# RealDocs documentation surfaces

The HTML wiki uses a dark charcoal palette with a green accent, serif section headings, system body text, and monospace source references. The index separates guides from source references and embeds the file map as the next section. The graph uses the same ruled surfaces as code samples, with a faint dotted field and separate colors for architectural zones and relationships. Labels, line patterns, and incoming or outgoing descriptions convey the same distinctions independently.

Shared color tokens live in `src/html.ts`. The file map uses them in `assets/file-map.css` and `assets/file-map.js`. Mermaid reads the same text and surface colors. The map lays out files by zone and retains those positions when filters change. Native sidebar controls and plain file rows provide keyboard access to the same selection and related-file details as the canvas.
