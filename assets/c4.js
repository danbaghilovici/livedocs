(() => {
  const $ = selector => document.querySelector(selector);
  const data = JSON.parse(document.getElementById('c4-data').textContent);
  const levels = new Map(data.levels.map(level => [level.key, level]));
  const elements = new Map(data.elements.map(element => [element.alias, element]));
  const css = getComputedStyle(document.documentElement);
  const color = name => css.getPropertyValue('--wiki-' + name).trim();
  const esc = text => String(text ?? '').replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
  const mermaid = globalThis.mermaid;
  if (mermaid) globalThis.realdocsConfigureMermaid?.(mermaid);

  let renderCount = 0;
  const state = { stack: [data.root], variant: null, selected: null, tab: 'overview' };
  const canvas = $('.canvas');
  canvas.classList.add('mermaid-c4');
  const panel = $('aside.panel');
  const levelNames = { C4Context: 'Level 1 · System context', C4Container: 'Level 2 · Containers', C4Component: 'Level 3 · Components' };
  const tabs = [['overview', 'Overview'], ['diagrams', 'Diagrams'], ['docs', 'Docs'], ['code', 'Code']];
  const currentLevel = () => levels.get(state.stack.at(-1));
  // A level built from several authored views opens on the first one; "All merged" is a toggle.
  const defaultVariant = () => currentLevel().views.length > 1 ? 0 : null;
  // Every element has one place in the hierarchy: its dotted path. Navigation follows that path,
  // never the route the reader took, so a peer that links back cannot grow the breadcrumb.
  const stackFor = alias => {
    const segments = elements.get(alias).path.split('.');
    return (levels.has('') ? ['', ...segments] : segments).filter(key => levels.has(key));
  };
  const isDescendant = alias => {
    const target = stackFor(alias);
    return state.stack.every((key, index) => target[index] === key);
  };
  const nodeFor = alias => canvas.querySelector(`.c4-shape[data-alias="${CSS.escape(alias)}"]`);
  const shapeRect = node => node.querySelector('rect.label-container, .label-container rect');
  const kindName = kind => kind.replace(/_Ext$/, ' (external)').replace(/Db/, ' database').replace(/Queue/, ' queue');
  // "Containers of the shop: billing" → "Billing"; titles without a qualifier stay whole.
  const variantName = title => {
    const qualifier = title.includes(': ') ? title.slice(title.indexOf(': ') + 2) : title;
    return qualifier.charAt(0).toUpperCase() + qualifier.slice(1);
  };

  async function renderMermaid(source, id = `c4d${++renderCount}`) {
    try {
      return (await mermaid.render(id, source)).svg;
    } finally {
      // A failed render leaves its error diagram in the body.
      document.getElementById('d' + id)?.remove();
    }
  }

  function setStroke(node, on) {
    const rect = shapeRect(node);
    if (!rect) return;
    if (on) {
      rect.style.setProperty('stroke', color('accent'), 'important');
      rect.style.setProperty('stroke-width', '4', 'important');
    } else {
      rect.style.removeProperty('stroke-width');
      rect.style.setProperty('stroke', rect.dataset.stroke, 'important');
    }
  }

  async function renderLevel() {
    const level = currentLevel();
    const source = state.variant == null ? level.merged ?? level.views[0].source : level.views[state.variant].source;
    const id = `c4v${++renderCount}`;
    try {
      canvas.innerHTML = await renderMermaid(source, id);
    } catch (error) {
      console.warn('Could not render a C4 view.', error);
      canvas.innerHTML = '<p class="empty">Could not render this view.</p>';
    }
    for (const node of canvas.querySelectorAll('.c4-shape')) {
      const alias = node.id.slice(id.length + 1);
      const element = elements.get(alias);
      node.dataset.alias = alias;
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      const down = element?.hasLevel && isDescendant(alias);
      node.setAttribute('aria-label', `${element?.label ?? alias}${element?.hasLevel ? (down ? ', can zoom in' : ', can go to its own view') : ''}`);
      const rect = shapeRect(node);
      if (rect) rect.dataset.stroke = rect.style.getPropertyValue('stroke');
      if (element?.hasLevel && rect) {
        node.classList.add('has-children');
        const x = +rect.getAttribute('x') + +rect.getAttribute('width') - 16;
        const y = +rect.getAttribute('y') + 16;
        node.insertAdjacentHTML('beforeend', `<g class="zoom-badge" transform="translate(${x} ${y})">
          <circle r="10" fill="${color('page')}" stroke="${color('accent')}" stroke-width="1.5"/>
          ${down ? `<path d="M-5 0H5M0 -5V5" stroke="${color('accent')}" stroke-width="2"/>`
                 : `<path d="M-4 4L4 -4M-2 -4H4V2" stroke="${color('accent')}" stroke-width="1.8" fill="none"/>`}</g>`);
      }
      if (alias === state.selected) setStroke(node, true);
    }
    renderChrome();
  }

  function renderChrome() {
    const level = currentLevel();
    $('nav.crumbs').innerHTML = state.stack.map((key, index) => {
      const last = index === state.stack.length - 1;
      return `${index ? '<span class="sep">›</span>' : ''}<button type="button" data-depth="${index}"${last ? ' aria-current="page"' : ''}>${esc(levels.get(key).label)}</button>`;
    }).join('');
    saveHash();
    $('.level').textContent = levelNames[level.type] ?? level.type;
    $('.variants').innerHTML = level.views.length > 1 ? [
      level.merged ? `<button type="button" data-variant="" aria-pressed="${state.variant == null}">All merged</button>` : '',
      ...level.views.map((view, index) => `<button type="button" data-variant="${index}" aria-pressed="${state.variant === index}" title="${esc(view.origin)}">${esc(variantName(view.title))}</button>`),
    ].join('') : '';
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let busy = false;
  async function transition(next, { into, outOf, slide } = {}) {
    if (busy) return;
    busy = true;
    try {
      // Rendering the next level destroys the focused box or button; put focus back afterwards.
      const active = document.activeElement;
      const hadFocus = [canvas, panel, $('nav.crumbs')].some(region => region.contains(active));
      // A level change closes the panel; the selected box is usually not on the next level.
      if (state.selected) closePanel({ restoreFocus: false });
      const stage = $('.stage').getBoundingClientRect();
      const aim = node => {
        const r = node.getBoundingClientRect();
        canvas.style.transformOrigin = `${r.left + r.width / 2 - stage.left}px ${r.top + r.height / 2 - stage.top}px`;
        canvas.style.transform = `scale(${Math.min(stage.width / r.width, stage.height / r.height) * .8})`;
      };
      const focus = into && nodeFor(into);
      canvas.style.transformOrigin = 'center';
      if (slide) canvas.style.transform = 'translateX(-12%)';
      else if (focus) aim(focus);
      else canvas.style.transform = 'scale(.55)';
      canvas.style.opacity = '0';
      await wait(380);
      next();
      state.variant = defaultVariant();
      await renderLevel();
      canvas.classList.add('instant');
      const back = outOf && nodeFor(outOf);
      const landing = back || (hadFocus && canvas.querySelector('.c4-shape'));
      if (landing) landing.focus({ preventScroll: true });
      canvas.style.transformOrigin = 'center';
      if (slide) canvas.style.transform = 'translateX(12%)';
      else if (back) aim(back);
      else canvas.style.transform = 'scale(.55)';
      canvas.getBoundingClientRect();
      canvas.classList.remove('instant');
      canvas.style.transform = 'none';
      canvas.style.opacity = '1';
      await wait(380);
    } finally {
      busy = false;
    }
  }
  function zoomIn(alias) {
    if (!elements.get(alias)?.hasLevel) return Promise.resolve();
    const target = stackFor(alias);
    if (isDescendant(alias)) return transition(() => { state.stack = target; }, { into: alias });
    return transition(() => { state.stack = target; }, { slide: true });
  }
  function zoomOut(depth = state.stack.length - 2) {
    if (depth < 0 || depth >= state.stack.length - 1) return Promise.resolve();
    const from = state.stack[depth + 1];
    return transition(() => { state.stack = state.stack.slice(0, depth + 1); }, { outOf: from });
  }

  function select(alias) {
    // During a transition the box clicked is on the outgoing level, and the panel was just closed.
    if (busy || !elements.has(alias)) return;
    if (state.selected) {
      const old = nodeFor(state.selected);
      if (old) setStroke(old, false);
    }
    state.selected = alias;
    const node = nodeFor(alias);
    if (node) setStroke(node, true);
    state.tab = 'overview';
    renderPanel();
    panel.classList.add('open');
  }
  function closePanel({ restoreFocus = true } = {}) {
    if (state.selected) {
      const old = nodeFor(state.selected);
      if (old) setStroke(old, false);
      if (restoreFocus) old?.focus();
    }
    state.selected = null;
    panel.classList.remove('open');
    saveHash();
  }

  const itemsFor = element => data.items.filter(item => item.path === element.path);

  function renderPanel() {
    const element = elements.get(state.selected);
    const items = itemsFor(element);
    const counts = Object.fromEntries(tabs.map(([key]) => [key, items.filter(item => item.tab === key).length]));
    if (state.tab !== 'overview' && !counts[state.tab]) state.tab = 'overview';
    const own = element.hasLevel && levels.get(element.alias);
    const down = isDescendant(element.alias);
    const levelWord = own && (levelNames[own.type]?.split(' · ')[1].toLowerCase() ?? 'details');
    const visible = tabs.filter(([key]) => key === 'overview' || counts[key]);
    panel.querySelector('.panel-inner').innerHTML = `
      <div class="panel-head">
        <div class="row"><h2>${esc(element.label)}</h2><button type="button" data-action="close" aria-label="Close panel">✕</button></div>
        <div class="kind">${esc(kindName(element.kind))}${element.technology ? ' · ' + esc(element.technology) : ''}</div>
        <div class="marker">Marker <code>@realdocs:c4 ${esc(element.path)}</code><button type="button" data-action="copy">Copy</button></div>
        ${own ? `<div class="panel-actions"><button type="button" class="primary" data-action="zoom">${down ? 'Zoom in to' : 'Go to'} ${esc(element.label)} ${esc(levelWord)} ${down ? '⊕' : '↗'}</button></div>` : ''}
      </div>
      <div role="tablist" aria-label="Element information">
        ${visible.map(([key, label]) => `<button type="button" role="tab" id="tab-${key}" aria-controls="tabpanel" aria-selected="${state.tab === key}" tabindex="${state.tab === key ? 0 : -1}" data-tab="${key}">${label}${key !== 'overview' ? `<span class="count">${counts[key]}</span>` : ''}</button>`).join('')}
      </div>
      <div role="tabpanel" id="tabpanel" aria-labelledby="tab-${state.tab}" tabindex="0"></div>`;
    const body = panel.querySelector('[role="tabpanel"]');
    saveHash();
    if (state.tab === 'overview') {
      body.innerHTML = overview(element, items);
      return;
    }
    const list = items.filter(item => item.tab === state.tab);
    body.innerHTML = list.map((item, index) => `
      <article class="item">
        <div class="item-head"><strong>${esc(item.title)}</strong>
          ${item.tab === 'diagrams' ? `<button type="button" data-enlarge="${index}">Enlarge</button>` : ''}
          <a href="${esc(item.href)}" target="_blank" rel="noopener">Open in wiki ↗</a></div>
        <div class="source">${esc(item.source)}</div>
        <div class="body${item.tab === 'diagrams' ? ' diagram' : ''}" data-index="${index}">${itemBody(item)}</div>
      </article>`).join('');
    list.forEach(async (item, index) => {
      const target = body.querySelector(`[data-index="${index}"]`);
      if (item.mermaid !== undefined) {
        try {
          target.innerHTML = await renderMermaid(item.mermaid);
        } catch (error) {
          console.warn('Could not render a Mermaid diagram.', error);
          target.textContent = 'Could not render this diagram.';
        }
      }
      await renderFences(target);
    });
    body.querySelectorAll('[data-enlarge]').forEach(button => button.addEventListener('click', () => {
      const dialog = $('#enlarge');
      dialog.querySelector('strong').textContent = list[+button.dataset.enlarge].title;
      dialog.querySelector('.dlg-body').innerHTML = body.querySelector(`[data-index="${button.dataset.enlarge}"]`).innerHTML;
      dialog.showModal();
    }));
  }

  function itemBody(item) {
    if (item.mermaid !== undefined) return '<span class="muted">Rendering…</span>';
    const parts = [];
    if (item.signature) parts.push(`<pre><code>${esc(item.signature)}</code></pre>`);
    if (item.summary) parts.push(`<p>${esc(item.summary)}</p>`);
    if (item.html) parts.push(item.html); // already-sanitized wiki HTML
    if (item.exports?.length) {
      parts.push(`<p class="muted">Exports</p><ul class="rels">${item.exports.map(entry => `<li><a href="${esc(entry.href)}"><code>${esc(entry.name)}</code></a></li>`).join('')}</ul>`);
    }
    return parts.join('') || '<p class="empty">No content.</p>';
  }

  // Mermaid fences in marked Docs content render when their tab opens, as on wiki pages.
  async function renderFences(container) {
    for (const code of container.querySelectorAll('pre > code.language-mermaid')) {
      const source = code.textContent;
      try {
        const diagram = await mermaid.parse(source, { suppressErrors: true });
        if (!diagram) continue;
        const figure = document.createElement('figure');
        figure.className = 'mermaid-diagram';
        if (diagram.diagramType === 'c4') figure.classList.add('mermaid-c4');
        figure.innerHTML = await renderMermaid(source);
        code.parentElement.replaceWith(figure);
      } catch (error) {
        console.warn('Could not render a Mermaid diagram.', error);
      }
    }
  }

  function overview(element, items) {
    // Relationships come from the element's home level, even after zooming into its own level.
    const home = levels.get(element.home);
    const relationships = new Map();
    for (const view of home?.views ?? []) {
      for (const relationship of view.relationships) {
        const key = relationship.from + '>' + relationship.to;
        if (!relationships.has(key)) relationships.set(key, relationship);
      }
    }
    const outgoing = [...relationships.values()].filter(r => r.from === element.alias);
    const incoming = [...relationships.values()].filter(r => r.to === element.alias);
    const link = alias => `<button type="button" data-goto="${esc(alias)}">${esc(elements.get(alias)?.label ?? alias)}</button>`;
    const entry = (r, other) => `<li>${link(other)} — ${esc(r.label)}${r.technology ? ` <span class="muted">[${esc(r.technology)}]</span>` : ''}</li>`;
    const counted = tabs.slice(1).map(([key, label]) => `${items.filter(item => item.tab === key).length} ${label.toLowerCase()}`).join(', ');
    return `
      <dl class="facts">
        <dt>Description</dt><dd>${element.description ? esc(element.description) : '<span class="empty">None.</span>'}</dd>
        ${element.technology ? `<dt>Technology</dt><dd>${esc(element.technology)}</dd>` : ''}
        <dt>Marked items</dt><dd>${items.length ? `${items.length} (${counted})` : '<span class="empty">None yet. Add the marker above to a guide, section, diagram or file.</span>'}</dd>
      </dl>
      <h3>Calls</h3>${outgoing.length ? `<ul class="rels">${outgoing.map(r => entry(r, r.to)).join('')}</ul>` : '<p class="empty">None in its level.</p>'}
      <h3>Called by</h3>${incoming.length ? `<ul class="rels">${incoming.map(r => entry(r, r.from)).join('')}</ul>` : '<p class="empty">None in its level.</p>'}
      <h3>Appears in</h3><ul class="rels">${element.appearsIn.map(view => `<li>${esc(view.title)}<br><span class="muted">${esc(view.origin)}</span></li>`).join('')}</ul>`;
  }

  canvas.addEventListener('click', event => {
    const node = event.target.closest('.c4-shape');
    if (node) select(node.dataset.alias);
    else closePanel();
  });
  canvas.addEventListener('dblclick', event => {
    const node = event.target.closest('.c4-shape');
    if (node) zoomIn(node.dataset.alias);
  });
  canvas.addEventListener('keydown', event => {
    const node = event.target.closest('.c4-shape');
    if (!node) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(node.dataset.alias);
    }
    if (event.key === '+') zoomIn(node.dataset.alias);
  });
  let wheelBudget = 0;
  let wheelTimer;
  $('.stage').addEventListener('wheel', event => {
    event.preventDefault();
    wheelBudget += event.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelBudget = 0; }, 250);
    if (busy) return;
    if (wheelBudget < -120) {
      wheelBudget = 0;
      const node = event.target.closest('.c4-shape.has-children');
      if (node) zoomIn(node.dataset.alias);
    } else if (wheelBudget > 120) {
      wheelBudget = 0;
      zoomOut();
    }
  }, { passive: false });
  canvas.addEventListener('mouseover', event => canvas.classList.toggle('zoomable-hover', !!event.target.closest('.has-children')));
  $('nav.crumbs').addEventListener('click', event => {
    const button = event.target.closest('button[data-depth]');
    if (button && !button.hasAttribute('aria-current')) zoomOut(+button.dataset.depth);
  });
  $('.variants').addEventListener('click', async event => {
    const button = event.target.closest('button[data-variant]');
    if (!button || busy) return;
    state.variant = button.dataset.variant === '' ? null : +button.dataset.variant;
    await renderLevel();
    if (state.selected && panel.classList.contains('open')) renderPanel();
  });
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') closePanel();
    if (action === 'zoom') zoomIn(state.selected);
    if (action === 'copy') navigator.clipboard?.writeText(`@realdocs:c4 ${elements.get(state.selected).path}`);
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      renderPanel();
      panel.querySelector(`#tab-${state.tab}`).focus();
    }
    const target = event.target.closest('[data-goto]');
    if (target && nodeFor(target.dataset.goto)) {
      select(target.dataset.goto);
      panel.querySelector('[role="tabpanel"]').focus(); // the clicked entry was replaced
    }
  });
  // ARIA tabs pattern: arrow keys, Home and End move between tabs.
  panel.addEventListener('keydown', event => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;
    const all = [...panel.querySelectorAll('[role="tab"]')];
    const index = all.indexOf(tab);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: all.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    state.tab = all[(next + all.length) % all.length].dataset.tab;
    renderPanel();
    panel.querySelector(`#tab-${state.tab}`).focus();
  });
  $('#enlarge button').addEventListener('click', () => $('#enlarge').close());
  document.addEventListener('keydown', event => {
    if (event.target.closest('dialog')) return;
    if (event.key === 'Escape' && panel.classList.contains('open')) closePanel();
    if (event.key === 'Backspace' && !event.target.closest('input, textarea')) {
      event.preventDefault();
      zoomOut();
    }
  });

  function saveHash() {
    const params = new URLSearchParams();
    if (state.stack.length > 1 || state.stack[0] !== data.root) params.set('level', state.stack.filter(Boolean).join(','));
    if (state.selected) params.set('select', state.selected);
    if (state.selected && state.tab !== 'overview') params.set('tab', state.tab);
    history.replaceState(null, '', params.size ? '#' + params : location.pathname + location.search);
  }

  const ready = (async () => {
    if (!mermaid) {
      canvas.innerHTML = '<p class="empty">Mermaid did not load, so the diagrams cannot be drawn.</p>';
      return;
    }
    const params = new URLSearchParams(location.hash.slice(1));
    const deepest = (params.get('level') ?? '').split(',').filter(key => levels.has(key) && elements.has(key)).at(-1);
    if (deepest) state.stack = stackFor(deepest);
    state.variant = defaultVariant();
    await renderLevel();
    const selected = params.get('select');
    if (elements.has(selected)) {
      select(selected);
      const tab = params.get('tab');
      if (tabs.some(([key]) => key === tab)) {
        state.tab = tab;
        renderPanel();
      }
    }
  })();
  globalThis.__c4 = { ready, state, zoomIn, zoomOut, select };
})();
