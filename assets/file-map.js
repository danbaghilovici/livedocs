(() => {
  const $ = id => document.getElementById(id);
  const data = JSON.parse($('file-map-data').textContent);
  const zones = [...new Set(data.nodes.map(node => node.zone))].sort();
  const css = getComputedStyle(document.documentElement);
  const color = name => css.getPropertyValue('--wiki-' + name).trim();
  const palette = {
    ink: color('ink'), surface: color('surface'), accent: color('accent'),
    zones: ['#81d6bc', '#b6bdf5', '#edc184', '#91c4eb', '#e9a5b4', '#b8d08d'],
    edges: { import: '#91beef', 're-export': '#c3a9e8', 'type-only': '#e1b383', 'doc-link': '#8ac4a9', declared: '#dfa5cd' },
  };
  const files = new Map(data.nodes.map(node => [node.path, node]));
  const zoneFilter = $('zone-filter');
  const search = $('find-file');
  const list = $('file-list');
  const neighborList = $('neighbor-list');
  const activeKinds = new Set(Object.keys(data.relations));
  const byZone = new Map(zones.map(zone => [zone, []]));
  const adjacency = new Map(data.nodes.map(node => [node.path, []]));
  const nodeIds = new Map(data.nodes.map((node, index) => [node.path, `f${index}`]));
  for (const node of data.nodes) byZone.get(node.zone).push(node);
  for (const edge of data.edges) {
    adjacency.get(edge.source).push(edge);
    adjacency.get(edge.target).push(edge);
  }

  const elements = [];
  const groupColumns = Math.ceil(Math.sqrt(zones.length));
  const largestZone = Math.max(1, ...[...byZone.values()].map(nodes => nodes.length));
  const groupWidth = Math.ceil(Math.sqrt(largestZone)) * 154 + 120;
  const groupHeight = Math.ceil(Math.sqrt(largestZone)) * 104 + 115;
  for (const [index, zone] of zones.entries()) {
    zoneFilter.add(new Option(zone, zone));
    const color = palette.zones[index % palette.zones.length];
    const parent = `z${index}`;
    elements.push({ data: { id: parent, label: zone, color }, classes: 'zone' });
    const group = byZone.get(zone);
    const columns = Math.ceil(Math.sqrt(group.length));
    for (const [member, node] of group.entries()) {
      elements.push({
        data: { id: nodeIds.get(node.path), parent, path: node.path, label: node.label, color, ink: palette.ink, surface: palette.surface, accent: palette.accent },
        position: {
          x: index % groupColumns * groupWidth + member % columns * 154,
          y: Math.floor(index / groupColumns) * groupHeight + Math.floor(member / columns) * 104 + (member % 2) * 16,
        },
        classes: `file ${node.kind}`,
      });
    }
  }
  for (const [index, edge] of data.edges.entries()) {
    elements.push({
      data: { id: `e${index}`, source: nodeIds.get(edge.source), target: nodeIds.get(edge.target), kind: edge.kind, color: palette.edges[edge.kind] },
      classes: edge.kind,
    });
  }

  for (const [kind, label] of Object.entries(data.relations)) {
    const row = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.kind = kind;
    row.append(checkbox, document.createTextNode(label));
    $('relationship-filter').append(row);
  }

  const cy = globalThis.cytoscape({
    container: $('map'), elements, layout: { name: 'preset', fit: false },
    minZoom: 0.04, maxZoom: 3, selectionType: 'single',
    style: [
      { selector: '.zone', style: {
        label: 'data(label)', color: 'data(color)', 'font-size': 17, 'font-weight': 700, 'font-family': 'system-ui',
        'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': -8, 'background-color': 'data(color)',
        'background-opacity': 0.065, 'border-color': 'data(color)', 'border-width': 1, 'border-opacity': 0.55, shape: 'round-rectangle', padding: 38,
      } },
      { selector: '.file', style: {
        label: 'data(label)', 'background-color': 'data(color)', 'border-color': 'data(surface)', 'border-width': 2,
        width: 20, height: 20, color: 'data(ink)', 'font-size': 17, 'font-family': 'ui-monospace, monospace',
        'text-valign': 'bottom', 'text-margin-y': 7, 'text-wrap': 'ellipsis', 'text-max-width': 137,
        'text-outline-color': 'data(surface)', 'text-outline-width': 2, 'min-zoomed-font-size': 6,
      } },
      { selector: '.doc', style: { shape: 'round-rectangle' } },
      { selector: 'edge', style: {
        'curve-style': 'bezier', width: 2.15, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle', 'arrow-scale': 0.75, opacity: 0.86,
      } },
      { selector: 'edge.doc-link, edge.type-only', style: { 'line-style': 'dashed' } },
      { selector: 'edge.declared', style: { 'line-style': 'dotted' } },
      { selector: '.muted', style: { opacity: 0.22 } },
      { selector: '.focused', style: { 'border-color': 'data(accent)', 'border-width': 4, 'overlay-color': 'data(accent)', 'overlay-opacity': 0.12, 'overlay-padding': 6 } },
      { selector: '.filtered', style: { display: 'none' } },
    ],
  });

  let selected;
  let neighborsOnly = false;

  function relatedTo(path) {
    return adjacency.get(path).filter(edge => activeKinds.has(edge.kind));
  }

  function fileButton(path, detail, pressed = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.path = path;
    button.setAttribute('aria-pressed', String(pressed));
    const name = document.createElement('span');
    name.textContent = path;
    button.append(name);
    if (detail) {
      const caption = document.createElement('small');
      caption.textContent = detail;
      button.append(caption);
    }
    const item = document.createElement('li');
    item.append(button);
    return item;
  }

  function draw({ fit = false, moveFocus = false } = {}) {
    const query = search.value.trim().toLowerCase();
    const incident = selected ? relatedTo(selected) : [];
    const neighbors = new Set(incident.map(edge => edge.source === selected ? edge.target : edge.source));
    const shown = data.nodes.filter(node => (!zoneFilter.value || node.zone === zoneFilter.value) &&
      node.path.toLowerCase().includes(query) && (!neighborsOnly || node.path === selected || neighbors.has(node.path)));
    const visible = new Set(shown.map(node => node.path));
    const visibleZones = new Set(shown.map(node => node.zone));
    const edges = data.edges.filter(edge => activeKinds.has(edge.kind) && visible.has(edge.source) && visible.has(edge.target));
    const shownEdges = new Set(edges);
    cy.batch(() => {
      for (const [index, zone] of zones.entries()) cy.getElementById(`z${index}`).toggleClass('filtered', !visibleZones.has(zone));
      for (const node of data.nodes) {
        const dot = cy.getElementById(nodeIds.get(node.path));
        dot.toggleClass('filtered', !visible.has(node.path));
        dot.toggleClass('focused', node.path === selected);
        dot.toggleClass('muted', !!selected && node.path !== selected && !neighbors.has(node.path));
      }
      for (const [index, edge] of data.edges.entries()) {
        const line = cy.getElementById(`e${index}`);
        line.toggleClass('filtered', !shownEdges.has(edge));
        line.toggleClass('muted', !!selected && edge.source !== selected && edge.target !== selected);
      }
    });
    if (fit && visible.size) cy.fit(cy.elements(':visible'), 52);
    $('map-count').textContent = `${shown.length} of ${data.nodes.length} files · ${edges.length} relationships · ${visibleZones.size} zones`;
    $('map-empty').hidden = visible.size > 0;

    const focusedFileButton = list.contains(document.activeElement) ? document.activeElement.dataset.path : undefined;
    list.replaceChildren(...shown.map(node => fileButton(node.path, node.zone, node.path === selected)));
    const focusedRow = [...list.querySelectorAll('button')].find(button => button.dataset.path === focusedFileButton);
    focusedRow?.focus({ preventScroll: true });

    const node = files.get(selected);
    $('selected-name').textContent = node?.path ?? 'Select a file';
    $('selected-zone').textContent = node?.zone ?? '';
    $('selection-help').hidden = !!node && incident.length > 0;
    $('selection-help').textContent = node ? 'No relationships match the current filters.' : 'Select a node or a file from the list to inspect its relationships.';
    $('selection-actions').hidden = !node;
    $('focus-neighbors').setAttribute('aria-pressed', String(neighborsOnly));
    $('open-file').hidden = !node?.href;
    if (node?.href) $('open-file').setAttribute('href', node.href);
    else $('open-file').removeAttribute('href');
    neighborList.replaceChildren(...incident.map(edge => {
      const outgoing = edge.source === selected;
      return fileButton(outgoing ? edge.target : edge.source, `${outgoing ? 'Outgoing' : 'Incoming'} · ${data.relations[edge.kind]}`);
    }));
    if (moveFocus) $('selected-name').focus();
  }

  function choose(path, moveFocus = false) {
    if (!path) neighborsOnly = false;
    selected = path;
    if (path && moveFocus) {
      search.value = '';
      zoneFilter.value = '';
    }
    draw({ fit: neighborsOnly, moveFocus });
  }

  for (const collection of [list, neighborList]) {
    collection.addEventListener('click', event => {
      const button = event.target.closest('button[data-path]');
      if (!button) return;
      choose(button.dataset.path, collection === neighborList);
      if (collection === list && matchMedia('(max-width: 700px)').matches) {
        $('selected-name').focus();
        $('selected-name').scrollIntoView({ block: 'nearest' });
      }
    });
  }
  const changeFilters = () => {
    const node = files.get(selected);
    if (node && ((zoneFilter.value && node.zone !== zoneFilter.value) || !node.path.toLowerCase().includes(search.value.trim().toLowerCase()))) {
      selected = undefined;
      neighborsOnly = false;
    }
    draw({ fit: true });
  };
  search.addEventListener('input', changeFilters);
  zoneFilter.addEventListener('change', changeFilters);
  $('relationship-filter').addEventListener('change', event => {
    const { checked, dataset } = event.target;
    if (checked) activeKinds.add(dataset.kind);
    else activeKinds.delete(dataset.kind);
    draw({ fit: neighborsOnly });
  });
  $('focus-neighbors').addEventListener('click', () => {
    neighborsOnly = !neighborsOnly;
    if (neighborsOnly) { search.value = ''; zoneFilter.value = ''; }
    draw({ fit: true });
  });
  $('clear-selection').addEventListener('click', () => { choose(undefined); search.focus(); });
  $('fit-map').addEventListener('click', () => cy.fit(cy.elements(':visible'), 52));
  for (const [id, multiplier] of [['zoom-in', 1.25], ['zoom-out', 0.8]]) {
    $(id).addEventListener('click', () => cy.zoom({ level: cy.zoom() * multiplier, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }));
  }
  cy.on('tap', '.file', event => choose(event.target.data('path')));
  cy.on('tap', event => { if (event.target === cy) choose(undefined); });
  $('selected-name').tabIndex = -1;
  draw({ fit: true });
})();
