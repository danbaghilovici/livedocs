(async () => {
  const mermaid = globalThis.mermaid;
  if (!mermaid) return;
  const style = getComputedStyle(document.documentElement);
  const color = name => style.getPropertyValue('--wiki-' + name).trim();
  mermaid.initialize({
    // Mermaid 12 changed the default flowchart layout, look, and label width (to 120px, which
    // clips single-word labels such as export names); keep the established rendering.
    startOnLoad: false, securityLevel: 'strict', theme: 'base', layout: 'dagre', look: 'classic',
    flowchart: { wrappingWidth: 200 },
    themeVariables: {
      darkMode: true, background: color('surface'), primaryColor: '#284137',
      primaryTextColor: color('ink'), primaryBorderColor: '#698d7e',
      lineColor: color('muted'), textColor: color('ink'),
      secondaryColor: '#2c3a4c', tertiaryColor: color('surface'),
      edgeLabelBackground: color('surface'), fontFamily: 'system-ui, sans-serif',
    },
    c4: {
      person_bg_color: '#285b4a', person_border_color: '#619b86',
      system_bg_color: '#315a72', system_border_color: '#7099af',
      container_bg_color: '#315a72', container_border_color: '#7099af',
      component_bg_color: '#2e5144', component_border_color: '#619b86',
    },
  });
  const diagrams = document.querySelectorAll('pre > code.language-mermaid');
  for (const [index, code] of diagrams.entries()) {
    const source = code.textContent;
    try {
      const diagram = await mermaid.parse(source, { suppressErrors: true });
      if (!diagram) continue;
      const { svg } = await mermaid.render('realdocs-diagram-' + index, source);
      const figure = document.createElement('figure');
      figure.className = 'mermaid-diagram';
      if (diagram.diagramType === 'c4') figure.classList.add('mermaid-c4');
      figure.innerHTML = svg;
      code.parentElement.replaceWith(figure);
    } catch (error) {
      console.warn('Could not render a Mermaid diagram.', error);
    }
  }
})();
