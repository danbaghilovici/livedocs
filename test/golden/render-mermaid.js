(async () => {
  const mermaid = globalThis.mermaid;
  if (!mermaid) return;
  mermaid.initialize({
    // Mermaid 12 changed the default flowchart layout, look, and label width (to 120px, which
    // clips single-word labels such as export names); keep the established rendering.
    startOnLoad: false, securityLevel: 'strict',
    theme: document.documentElement.dataset.bsTheme === 'dark' ? 'dark' : 'default', layout: 'dagre', look: 'classic',
    flowchart: { wrappingWidth: 200 },
  });
  const diagrams = document.querySelectorAll('pre > code.language-mermaid');
  for (const [index, code] of diagrams.entries()) {
    const source = code.textContent;
    try {
      const diagram = await mermaid.parse(source, { suppressErrors: true });
      if (!diagram) continue;
      const { svg } = await mermaid.render('realdocs-diagram-' + index, source);
      const figure = document.createElement('figure');
      figure.className = 'mermaid-diagram border rounded p-3';
      if (diagram.diagramType === 'c4') figure.classList.add('mermaid-c4');
      figure.innerHTML = svg;
      code.parentElement.replaceWith(figure);
    } catch (error) {
      console.warn('Could not render a Mermaid diagram.', error);
    }
  }
})();
