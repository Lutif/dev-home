/* ═══════════════════════════════════════════
   HOME — Side Panel Controller
   ═══════════════════════════════════════════ */

// ────── State ──────
let cache = { github: null, slack: null, calendar: null };

// ────── DOM refs ──────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ────── Section Toggle (Collapse/Expand) ──────
$$('.section__header').forEach(header => {
  header.addEventListener('click', (e) => {
    // Don't toggle if clicking on a button
    if (e.target.closest('button:not(.section__toggle)')) return;

    const section = header.closest('.section');
    section.classList.toggle('section--expanded');
  });
});

// ────── Refresh All ──────
$('#syncSpaceBtn').addEventListener('click', async () => {
  await persistCurrentSpaceSnapshot({ showFeedback: true });
});

$('#refreshAll').addEventListener('click', () => {
  const btn = $('#refreshAll');
  btn.classList.add('spinning');
  setTimeout(() => btn.classList.remove('spinning'), 800);

  loadCurrentSpace();
  loadSavedSpaces();
  refreshService('github');
  refreshService('slack');
  refreshService('calendar');
});

// Per-service refresh buttons
$$('.refresh-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const service = btn.dataset.refresh;
    btn.classList.add('spinning');
    setTimeout(() => btn.classList.remove('spinning'), 800);
    refreshService(service);
  });
});

// ════════════════════════════════════
//  COMMAND BAR (quick search)
// ════════════════════════════════════
const commandBarInput = $('#commandBarInput');
const commandBarResults = $('#commandBarResults');
let commandBarSelectedIndex = -1;
let commandBarItems = [];

async function buildCommandBarIndex() {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const items = [];
  workspaces.forEach((ws) => {
    const label = (ws.emoji ? ws.emoji + ' ' : '') + (ws.name || 'Unnamed');
    items.push({ type: 'workspace', label, meta: `${(ws.pinnedTabs || []).length + (ws.tabs || []).length} tabs`, id: ws.id, ws });
  });
  workspaces.forEach((ws) => {
    const allTabs = [...(ws.pinnedTabs || []), ...(ws.tabs || [])];
    allTabs.forEach((t) => {
      items.push({ type: 'tab', label: t.title || t.url, meta: ws.name, url: t.url, wsId: ws.id, ws });
    });
  });
  return items;
}

function filterCommandBarItems(items, q) {
  const lower = q.trim().toLowerCase();
  if (!lower) return items.slice(0, 20);
  return items.filter((it) => {
    const label = (it.label || '').toLowerCase();
    const meta = (it.meta || '').toLowerCase();
    const url = (it.url || '').toLowerCase();
    return label.includes(lower) || meta.includes(lower) || url.includes(lower);
  }).slice(0, 25);
}

function renderCommandBarResults(items) {
  commandBarItems = items;
  commandBarSelectedIndex = -1;
  if (items.length === 0) {
    commandBarResults.hidden = true;
    return;
  }
  let lastSection = '';
  const html = items.map((it, i) => {
    const section = it.type === 'action' ? 'Actions' : it.type === 'workspace' ? 'Workspaces' : 'Tabs';
    const sectionEl = lastSection !== section ? `<div class="command-bar__result-section">${section}</div>` : '';
    lastSection = section;
    const icon = it.type === 'action' ? '◇' : it.type === 'workspace' ? '▣' : '◫';
    return `${sectionEl}<button class="command-bar__result" data-index="${i}" type="button">
      <span class="command-bar__result-icon">${icon}</span>
      <div class="command-bar__result-body">
        <span class="command-bar__result-label">${escapeHtml(truncate(it.label, 50))}</span>
        ${it.meta ? `<span class="command-bar__result-meta">${escapeHtml(truncate(it.meta, 40))}</span>` : ''}
      </div>
    </button>`;
  }).join('');
  commandBarResults.innerHTML = html;
  commandBarResults.hidden = false;
  commandBarResults.querySelectorAll('.command-bar__result').forEach((btn, i) => {
    btn.addEventListener('click', () => runCommandBarItem(commandBarItems[i]));
  });
}

function runCommandBarItem(item) {
  commandBarResults.hidden = true;
  commandBarInput.value = '';
  if (item.type === 'tab') {
    if (item.url) chrome.tabs.create({ url: item.url });
  } else if (item.type === 'workspace' && item.ws) {
    restoreWorkspaceFromCommandBar(item.ws, false);
  }
}

async function restoreWorkspaceFromCommandBar(ws, replaceWindow) {
  const pinnedList = ws.pinnedTabs || [];
  const regularList = ws.tabs || [];
  const allTabs = [...pinnedList, ...regularList];
  if (allTabs.length === 0) return;
  const win = await chrome.windows.getLastFocused();
  if (!win) return;
  if (replaceWindow) {
    const existing = await chrome.tabs.query({ windowId: win.id });
    const ids = existing.map(t => t.id).filter(Boolean);
    if (ids.length) await chrome.tabs.remove(ids);
  }
  const createdIds = [];
  for (const tab of allTabs) {
    if (!tab.url) continue;
    const created = await chrome.tabs.create({ url: tab.url, windowId: win.id });
    createdIds.push(created.id);
  }
  const pinnedCount = pinnedList.length;
  for (let i = 0; i < pinnedCount && i < createdIds.length; i++) {
    try { await chrome.tabs.update(createdIds[i], { pinned: true }); } catch (_) {}
  }
  if (chrome.tabGroups && ws.folders && ws.folders.length) {
    for (const folder of ws.folders) {
      const tabIds = (folder.tabIndices || []).map(i => createdIds[pinnedCount + i]).filter(Boolean);
      if (tabIds.length === 0) continue;
      try {
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, { title: folder.name });
      } catch (_) {}
    }
  }
}

commandBarInput.addEventListener('input', async () => {
  const q = commandBarInput.value;
  const index = await buildCommandBarIndex();
  const filtered = filterCommandBarItems(index, q);
  renderCommandBarResults(filtered);
});

commandBarInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    commandBarResults.hidden = true;
    commandBarInput.blur();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  e.preventDefault();
  const btns = commandBarResults.querySelectorAll('.command-bar__result');
  if (btns.length === 0) return;
  if (e.key === 'ArrowDown') {
    commandBarSelectedIndex = Math.min(commandBarSelectedIndex + 1, commandBarItems.length - 1);
  } else if (e.key === 'ArrowUp') {
    commandBarSelectedIndex = Math.max(commandBarSelectedIndex - 1, -1);
  } else if (e.key === 'Enter') {
    if (commandBarSelectedIndex >= 0 && commandBarItems[commandBarSelectedIndex]) {
      const item = commandBarItems[commandBarSelectedIndex];
      if (e.metaKey || e.ctrlKey) {
        if (item.url) openInLittleArc(item.url);
        else if (item.ws) runCommandBarItem(item);
      } else {
        runCommandBarItem(item);
      }
    }
    return;
  }
  btns.forEach((b, i) => b.classList.toggle('command-bar__result--selected', i === commandBarSelectedIndex));
  if (commandBarSelectedIndex >= 0) btns[commandBarSelectedIndex].scrollIntoView({ block: 'nearest' });
});

commandBarInput.addEventListener('blur', () => {
  setTimeout(() => { commandBarResults.hidden = true; }, 150);
});

// Focus command bar when opened via keyboard shortcut
chrome.storage.session.get('focusCommandBar').then(({ focusCommandBar }) => {
  if (focusCommandBar) {
    chrome.storage.session.remove('focusCommandBar');
    commandBarInput.focus();
  }
});

// ════════════════════════════════════
//  SPACES (Arc-style: current space + saved spaces)
// ════════════════════════════════════
let currentWindowId = null;
let currentSpaceId = null;

const spacesEmojiRow = $('#spacesEmojiRow');
const pinnedEntriesList = $('#pinnedEntriesList');
const pinnedFoldersList = $('#pinnedFoldersList');
const liveTabsList = $('#liveTabsList');
const liveFoldersList = $('#liveFoldersList');
const currentSpaceEmojiEl = $('#currentSpaceEmoji');
const currentSpaceTitleNameEl = $('#currentSpaceTitleName');

function normalizeSpace(space) {
  return {
    id: space.id,
    name: space.name || 'Unnamed',
    emoji: typeof space.emoji === 'string' ? [...space.emoji.trim()].slice(0, 2).join('') : '',
    pinnedEntries: Array.isArray(space.pinnedEntries) ? space.pinnedEntries : [],
    pinnedFolders: Array.isArray(space.pinnedFolders) ? space.pinnedFolders.map(f => {
      // Migrate legacy entryIndices → entryUrls
      if (!f.entryUrls && Array.isArray(f.entryIndices) && Array.isArray(space.pinnedEntries)) {
        return { ...f, entryUrls: f.entryIndices.map(i => space.pinnedEntries[i] && space.pinnedEntries[i].url).filter(Boolean) };
      }
      return { ...f, entryUrls: Array.isArray(f.entryUrls) ? f.entryUrls : [] };
    }) : [],
    sections: Array.isArray(space.sections) ? space.sections : ['github', 'slack', 'calendar'], // default: all sections
    theme: space.theme || {
      primary: '#6366f1',
      background: '#0f1117',
      surface: '#1a1d27',
      accent: '#818cf8'
    },
    autoArchiveHours: space.autoArchiveHours === 24 ? 24 : 12,
    saved: !!space.saved,
    createdAt: space.createdAt,
    recentlyClosed: Array.isArray(space.recentlyClosed) ? space.recentlyClosed : []
  };
}

async function ensureSpacesStorage() {
  const { spaces, windowIdToSpaceId } = await chrome.storage.local.get(['spaces', 'windowIdToSpaceId']);
  if (!spaces || typeof spaces !== 'object') {
    await chrome.storage.local.set({ spaces: {} });
  }
  if (!windowIdToSpaceId || typeof windowIdToSpaceId !== 'object') {
    await chrome.storage.local.set({ windowIdToSpaceId: {} });
  }
}

async function getOrCreateCurrentSpace() {
  const win = await chrome.windows.getLastFocused();
  if (!win || win.id == null) return { space: null, windowId: null };
  const windowId = win.id;
  await ensureSpacesStorage();
  const { spaces = {}, windowIdToSpaceId = {} } = await chrome.storage.local.get(['spaces', 'windowIdToSpaceId']);
  let spaceId = windowIdToSpaceId[windowId];
  if (!spaceId || !spaces[spaceId]) {
    spaceId = 'space_' + Date.now();
    const space = {
      id: spaceId,
      name: 'Space ' + (Object.keys(spaces).length + 1),
      emoji: '',
      pinnedEntries: [],
      pinnedFolders: [],
      sections: ['github', 'slack', 'calendar'], // default: all sections enabled
      theme: { primary: '#5c6bc0', background: '#f5f0e8', surface: '#faf7f2', accent: '#3f51b5' },
      autoArchiveHours: 12,
      saved: false,
      createdAt: new Date().toISOString()
    };
    spaces[spaceId] = space;
    windowIdToSpaceId[windowId] = spaceId;
    await chrome.storage.local.set({ spaces, windowIdToSpaceId });
  }
  currentWindowId = windowId;
  currentSpaceId = spaceId;
  return { space: normalizeSpace(spaces[spaceId]), windowId };
}

function applyTheme(theme) {
  const root = document.documentElement;
  const t = theme || { primary: '#5c6bc0', background: '#f5f0e8', surface: '#faf7f2', accent: '#3f51b5' };

  const bgBrightness = getBrightness(t.background);
  const isLight = bgBrightness > 128;

  root.style.setProperty('--primary', t.primary);
  root.style.setProperty('--primary-hover', isLight ? darken(t.primary, 10) : lighten(t.primary, 10));
  root.style.setProperty('--primary-soft', hexToRgba(t.primary, 0.1));
  root.style.setProperty('--bg', t.background);
  root.style.setProperty('--bg-deep', isLight ? darken(t.background, 4) : darken(t.background, 3));
  root.style.setProperty('--surface', t.surface);
  root.style.setProperty('--surface-hover', isLight ? darken(t.surface, 5) : lighten(t.surface, 5));
  root.style.setProperty('--surface-raised', isLight ? '#ffffff' : lighten(t.surface, 4));
  root.style.setProperty('--border', isLight ? darken(t.surface, 12) : lighten(t.surface, 12));
  root.style.setProperty('--border-light', isLight ? darken(t.surface, 6) : lighten(t.surface, 6));
  root.style.setProperty('--text', isLight ? '#1c1a17' : '#e4e4e7');
  root.style.setProperty('--text-muted', isLight ? '#7a7369' : '#71717a');
  root.style.setProperty('--text-light', isLight ? '#a09890' : '#52525b');
}

function lighten(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * (percent / 100)));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * (percent / 100)));
  const b = Math.min(255, (num & 0xff) + Math.round(255 * (percent / 100)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function darken(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - Math.round(255 * (percent / 100)));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * (percent / 100)));
  const b = Math.max(0, (num & 0xff) - Math.round(255 * (percent / 100)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function hexToRgba(color, alpha) {
  const num = parseInt(color.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getBrightness(color) {
  const num = parseInt(color.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000;
}

async function loadCurrentSpace() {
  const { space, windowId } = await getOrCreateCurrentSpace();
  if (!space || windowId == null) return;

  if (currentSpaceEmojiEl) currentSpaceEmojiEl.textContent = space.emoji || '◇';
  if (currentSpaceTitleNameEl) currentSpaceTitleNameEl.textContent = space.name || 'Current Space';

  // Apply theme colors
  applyTheme(space.theme);

  // Show/hide service sections based on space's enabled sections
  const sections = space.sections || ['github', 'slack', 'calendar'];
  const githubSection = $('.section[data-section="github"]');
  const slackSection = $('.section[data-section="slack"]');
  const calendarSection = $('.section[data-section="calendar"]');

  if (githubSection) githubSection.hidden = !sections.includes('github');
  if (slackSection) slackSection.hidden = !sections.includes('slack');
  if (calendarSection) calendarSection.hidden = !sections.includes('calendar');

  const pinnedUrls = new Set((space.pinnedEntries || []).map(e => e.url));
  const allTabs = await chrome.tabs.query({ windowId });
  const unpinnedTabs = allTabs.filter(t => t.url && !pinnedUrls.has(t.url));

  let groups = [];
  if (chrome.tabGroups) {
    try {
      groups = await chrome.tabGroups.query({ windowId });
    } catch (_) {}
  }

  const tabsInGroups = new Set();
  groups.forEach(g => {
    allTabs.forEach(t => { if (t.groupId === g.id) tabsInGroups.add(t.id); });
  });

  // Above separator: pinned entries + pinned folders
  const entries = space.pinnedEntries || [];
  const folders = space.pinnedFolders || [];
  const entriesInFolders = new Set();
  folders.forEach(f => (f.entryUrls || []).forEach(u => entriesInFolders.add(u)));

  let pinnedHtml = '';
  entries.forEach((entry, i) => {
    if (entriesInFolders.has(entry.url)) return;
    const openTab = allTabs.find(t => t.url === entry.url);
    const iconHtml = entry.favIconUrl
      ? `<img class="space-entry__icon" src="${entry.favIconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const fallbackHtml = `<span class="space-entry__icon-fallback" style="${entry.favIconUrl ? 'display:none' : ''}">${getDomainInitial(entry.url)}</span>`;

    pinnedHtml += `
      <div class="space-entry space-entry--pinned" draggable="true" data-url="${escapeHtml(entry.url)}" data-index="${i}" data-type="pinned-entry">
        <span class="space-entry__drag-handle">⋮⋮</span>
        ${iconHtml}${fallbackHtml}
        <div class="space-entry__title-wrap">
          <span class="space-entry__title">${escapeHtml(truncate(entry.title || entry.url, 40))}</span>
          <span class="space-entry__domain">${escapeHtml(getDomain(entry.url))}</span>
        </div>
        ${openTab ? '<span class="space-entry__dot" title="Open"></span>' : ''}
        <button type="button" class="btn btn--ghost btn--sm space-entry-menu" data-index="${i}" data-url="${escapeHtml(entry.url)}" title="More">···</button>
      </div>`;
  });
  pinnedEntriesList.innerHTML = pinnedHtml || '<div class="space-empty space-empty--rich"><span class="space-empty__icon">📌</span><span class="space-empty__text">No pinned entries</span><span class="space-empty__hint">Pin tabs to keep them here</span></div>';

  // Build a URL→entry map for fast lookup
  const entryByUrl = new Map(entries.map(e => [e.url, e]));

  let pinnedFoldersHtml = '';
  folders.forEach((folder, fi) => {
    const collapsed = folder.collapsed;
    const urls = folder.entryUrls || [];
    const folderEntries = urls.map(u => entryByUrl.get(u)).filter(Boolean);
    pinnedFoldersHtml += `
      <div class="space-folder ${collapsed ? 'space-folder--collapsed' : ''}" data-folder-index="${fi}">
        <button type="button" class="space-folder__header" data-folder-index="${fi}">
          <svg class="space-folder__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
          <span class="space-folder__name">${escapeHtml(folder.name || 'Unnamed')}</span>
          <button type="button" class="btn btn--ghost btn--sm space-folder-delete" data-folder-index="${fi}" title="Delete folder">×</button>
        </button>
        <div class="space-folder__content" data-folder-index="${fi}" data-drop-zone="folder">
          ${folderEntries.length > 0 ? folderEntries.map((entry, ei) => {
            const openTab = allTabs.find(t => t.url === entry.url);
            const folderIconHtml = entry.favIconUrl
              ? `<img class="space-entry__icon" src="${entry.favIconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
              : '';
            const folderFallbackHtml = `<span class="space-entry__icon-fallback" style="${entry.favIconUrl ? 'display:none' : ''}">${getDomainInitial(entry.url)}</span>`;
            const entryIdx = entries.findIndex(e => e.url === entry.url);
            return `
            <div class="space-entry space-entry--pinned" draggable="true" data-url="${escapeHtml(entry.url)}" data-type="pinned-entry">
              <span class="space-entry__drag-handle">⋮⋮</span>
              ${folderIconHtml}${folderFallbackHtml}
              <div class="space-entry__title-wrap">
                <span class="space-entry__title">${escapeHtml(truncate(entry.title || entry.url, 35))}</span>
                <span class="space-entry__domain">${escapeHtml(getDomain(entry.url))}</span>
              </div>
              ${openTab ? '<span class="space-entry__dot"></span>' : ''}
              <button type="button" class="btn btn--ghost btn--sm space-entry-menu" data-index="${entryIdx >= 0 ? entryIdx : ''}" data-url="${escapeHtml(entry.url)}" title="More">···</button>
            </div>`;
          }).join('') : '<div class="space-empty">Drop entries here</div>'}
        </div>
      </div>`;
  });
  pinnedFoldersList.innerHTML = pinnedFoldersHtml;

  // Below separator: live tabs + groups
  const ungroupedTabs = unpinnedTabs.filter(t => !tabsInGroups.has(t.id));
  let liveHtml = '';
  ungroupedTabs.forEach(tab => {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;
    const isActive = tab.active === true;
    const tabIconHtml = tab.favIconUrl
      ? `<img class="space-entry__icon" src="${tab.favIconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const tabFallbackHtml = `<span class="space-entry__icon-fallback" style="${tab.favIconUrl ? 'display:none' : ''}">${getDomainInitial(tab.url)}</span>`;
    liveHtml += `
      <div class="space-entry space-entry--tab${isActive ? ' space-entry--active' : ''}" draggable="true" data-tab-id="${tab.id}" data-url="${escapeHtml(tab.url)}" data-type="live-tab">
        <input type="checkbox" class="tab-checkbox" data-tab-id="${tab.id}" title="Select">
        <span class="space-entry__drag-handle">⋮⋮</span>
        ${tabIconHtml}${tabFallbackHtml}
        <div class="space-entry__title-wrap">
          <span class="space-entry__title">${escapeHtml(truncate(tab.title || tab.url, 40))}</span>
          <span class="space-entry__domain">${escapeHtml(getDomain(tab.url))}</span>
        </div>
        <button type="button" class="btn btn--ghost btn--sm space-entry-menu" data-tab-id="${tab.id}" title="More actions">···</button>
      </div>`;
  });
  liveTabsList.innerHTML = liveHtml || '<div class="space-empty space-empty--rich"><span class="space-empty__icon">🗂️</span><span class="space-empty__text">No tabs open</span><span class="space-empty__hint">Open a tab to see it here</span></div>';

  let liveFoldersHtml = '';
  for (const g of groups) {
    const groupTabs = allTabs.filter(t => t.groupId === g.id);
    const collapsed = await getGroupCollapsed(g.id);
    liveFoldersHtml += `
      <div class="space-folder space-folder--live ${collapsed ? 'space-folder--collapsed' : ''}" data-group-id="${g.id}">
        <button type="button" class="space-folder__header space-folder__header--live" data-group-id="${g.id}">
          <svg class="space-folder__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
          <span class="space-folder__name">${escapeHtml((g.title && g.title.trim()) || 'Unnamed')}</span>
          <button type="button" class="btn btn--ghost btn--sm space-tabgroup-delete" data-group-id="${g.id}" title="Ungroup tabs">×</button>
        </button>
        <div class="space-folder__content" data-group-id="${g.id}" data-drop-zone="tabgroup">
          ${groupTabs.map(tab => {
            const isActiveGroupTab = tab.active === true;
            const grpIconHtml = tab.favIconUrl
              ? `<img class="space-entry__icon" src="${tab.favIconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
              : '';
            const grpFallbackHtml = `<span class="space-entry__icon-fallback" style="${tab.favIconUrl ? 'display:none' : ''}">${getDomainInitial(tab.url)}</span>`;
            return `
            <div class="space-entry space-entry--tab${isActiveGroupTab ? ' space-entry--active' : ''}" draggable="true" data-tab-id="${tab.id}" data-url="${escapeHtml(tab.url)}" data-type="live-tab" data-group-id="${g.id}">
              <input type="checkbox" class="tab-checkbox" data-tab-id="${tab.id}" title="Select">
              <span class="space-entry__drag-handle">⋮⋮</span>
              ${grpIconHtml}${grpFallbackHtml}
              <div class="space-entry__title-wrap">
                <span class="space-entry__title">${escapeHtml(truncate(tab.title || tab.url, 35))}</span>
                <span class="space-entry__domain">${escapeHtml(getDomain(tab.url))}</span>
              </div>
              <button type="button" class="btn btn--ghost btn--sm space-entry-menu" data-tab-id="${tab.id}" title="More actions">···</button>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }
  liveFoldersList.innerHTML = liveFoldersHtml;

  // Render recently closed for this space
  renderRecentlyClosed(space.recentlyClosed || []);

  attachSpaceEventListeners(space, windowId, allTabs);
}

async function getGroupCollapsed(groupId) {
  const key = 'groupCollapsed_' + groupId;
  const { [key]: collapsed } = await chrome.storage.local.get(key);
  return !!collapsed;
}

/** Build snapshot from current window and space, then persist to spaces and workspaces (if saved). */
function updateSyncLabel(state) {
  const btn = $('#syncSpaceBtn');
  const label = $('#syncLabel');
  if (!btn || !label) return;
  if (state === 'syncing') {
    btn.classList.add('syncing');
    btn.classList.remove('saved');
    label.textContent = 'Syncing…';
  } else if (state === 'saved') {
    btn.classList.remove('syncing');
    btn.classList.add('saved');
    const now = new Date();
    label.textContent = `Saved ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    setTimeout(() => {
      btn.classList.remove('saved');
      label.textContent = 'Sync';
    }, 3000);
  } else {
    btn.classList.remove('syncing', 'saved');
    label.textContent = 'Sync';
  }
}

async function persistCurrentSpaceSnapshot({ showFeedback = false } = {}) {
  if (currentSpaceId == null || currentWindowId == null) return;

  // Check storage quota and warn if approaching limit
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usagePercent = (estimate.usage / estimate.quota) * 100;

      if (usagePercent > 80) {
        console.warn(`Storage at ${usagePercent.toFixed(1)}% capacity (${(estimate.usage / 1024 / 1024).toFixed(2)}MB used)`);
        showStorageWarning(usagePercent, estimate.usage, estimate.quota);
      }
    } catch (e) {
      console.error('Failed to check storage quota:', e);
    }
  }

  if (showFeedback) updateSyncLabel('syncing');
  const { space } = await getOrCreateCurrentSpace();
  if (!space) { if (showFeedback) updateSyncLabel('idle'); return; }
  let tabs;
  try {
    tabs = await chrome.tabs.query({ windowId: currentWindowId });
  } catch (_) {
    if (showFeedback) updateSyncLabel('idle');
    return;
  }
  const pinnedUrls = new Set((space.pinnedEntries || []).map(e => e.url));
  const unpinnedTabs = tabs
    .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !pinnedUrls.has(t.url))
    .map(t => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl || '' }));

  let folders = [];
  if (chrome.tabGroups) {
    try {
      const groups = await chrome.tabGroups.query({ windowId: currentWindowId });
      const regular = tabs.filter(t => !t.pinned && !pinnedUrls.has(t.url));
      for (const g of groups) {
        const indices = [];
        regular.forEach((t, i) => {
          if (t.groupId === g.id) indices.push(i);
        });
        if (indices.length) folders.push({ id: g.id, name: (g.title && g.title.trim()) || 'Unnamed', tabIndices: indices });
      }
    } catch (_) {}
  }

  const { spaces = {}, workspaces = [] } = await chrome.storage.local.get(['spaces', 'workspaces']);
  const spaceData = spaces[currentSpaceId];
  if (spaceData) {
    spaceData.pinnedEntries = space.pinnedEntries || [];
    spaceData.pinnedFolders = space.pinnedFolders || [];
    spaceData.name = spaceData.name || space.name || 'Unnamed';
    if (space.emoji !== undefined) spaceData.emoji = space.emoji;
    spaces[currentSpaceId] = spaceData;
    await chrome.storage.local.set({ spaces });
  }

  const wsIndex = workspaces.findIndex(w => w.id === currentSpaceId);
  if (wsIndex >= 0) {
    const currentSpaceData = spaces[currentSpaceId];
    workspaces[wsIndex] = {
      ...workspaces[wsIndex],
      name: (currentSpaceData && currentSpaceData.name) || workspaces[wsIndex].name,
      emoji: (currentSpaceData && currentSpaceData.emoji) !== undefined ? currentSpaceData.emoji : workspaces[wsIndex].emoji,
      pinnedTabs: (space.pinnedEntries || []).slice(),
      tabs: unpinnedTabs,
      folders,
      lastSyncedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ workspaces, lastActiveWorkspaceId: currentSpaceId });
    loadSavedSpaces();
  }

  if (showFeedback) updateSyncLabel('saved');
}

function setGroupCollapsed(groupId, collapsed) {
  chrome.storage.local.set({ ['groupCollapsed_' + groupId]: collapsed });
}

// Event delegation - set up once on page load, no memory leaks
function setupEventDelegation() {
  // Pinned entries list
  if (pinnedEntriesList) {
    pinnedEntriesList.addEventListener('click', async (e) => {
      const menuBtn = e.target.closest('.space-entry-menu');
      if (menuBtn && menuBtn.dataset.index !== undefined && !menuBtn.dataset.tabId) {
        showPinnedEntryMenu(e, menuBtn.dataset.index, menuBtn.dataset.url);
        return;
      }

      const entry = e.target.closest('.space-entry--pinned');
      if (entry && !e.target.closest('button')) {
        const url = entry.dataset.url;
        if (!url) return;
        const tabs = await chrome.tabs.query({ windowId: currentWindowId });
        const tab = tabs.find(t => t.url === url);
        if (tab) {
          try {
            await chrome.tabs.update(tab.id, { active: true });
            await chrome.windows.update(currentWindowId, { focused: true });
          } catch (_) {}
        } else {
          try {
            await chrome.tabs.create({ url, windowId: currentWindowId });
          } catch (_) {}
        }
      }
    });
  }

  // Pinned folders list
  if (pinnedFoldersList) {
    pinnedFoldersList.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('.space-folder-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const fi = parseInt(deleteBtn.dataset.folderIndex, 10);
        if (confirm('Delete this folder? (Entries will remain pinned)')) {
          await deletePinnedFolder(fi);
        }
        return;
      }

      const folderHeader = e.target.closest('.space-folder__header');
      if (folderHeader && !e.target.closest('.space-folder-delete')) {
        const fi = parseInt(folderHeader.dataset.folderIndex, 10);
        const { spaces = {} } = await chrome.storage.local.get('spaces');
        const space = spaces[currentSpaceId];
        if (space && space.pinnedFolders && space.pinnedFolders[fi]) {
          const collapsed = !space.pinnedFolders[fi].collapsed;
          space.pinnedFolders[fi].collapsed = collapsed;
          await chrome.storage.local.set({ spaces });
          loadCurrentSpace();
        }
        return;
      }

      const menuBtn = e.target.closest('.space-entry-menu');
      if (menuBtn && !menuBtn.dataset.tabId) {
        showPinnedEntryMenu(e, menuBtn.dataset.index, menuBtn.dataset.url);
        return;
      }

      const moveOutBtn = e.target.closest('.space-entry-move-out');
      if (moveOutBtn) {
        e.stopPropagation();
        await moveEntryToFolder(moveOutBtn.dataset.url, -1);
        return;
      }

      const entry = e.target.closest('.space-entry--pinned');
      if (entry && !e.target.closest('button')) {
        const url = entry.dataset.url;
        if (!url) return;
        const tabs = await chrome.tabs.query({ windowId: currentWindowId });
        const tab = tabs.find(t => t.url === url);
        if (tab) {
          try {
            await chrome.tabs.update(tab.id, { active: true });
            await chrome.windows.update(currentWindowId, { focused: true });
          } catch (_) {}
        } else {
          try {
            await chrome.tabs.create({ url, windowId: currentWindowId });
          } catch (_) {}
        }
      }
    });
  }

  // Live tabs list
  if (liveTabsList) {
    liveTabsList.addEventListener('click', async (e) => {
      const menuBtn = e.target.closest('.space-entry-menu');
      if (menuBtn && menuBtn.dataset.tabId) {
        showTabEntryMenu(e, menuBtn.dataset.tabId, menuBtn.closest('.space-entry--tab')?.dataset.url || '');
        return;
      }

      const entry = e.target.closest('.space-entry--tab');
      if (entry && !e.target.closest('button') && !e.target.classList.contains('tab-checkbox')) {
        const tabId = parseInt(entry.dataset.tabId, 10);
        if (tabId) chrome.tabs.update(tabId, { active: true }).catch(() => {});
      }
    });
  }

  // Live folders list (tab groups)
  if (liveFoldersList) {
    liveFoldersList.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('.space-tabgroup-delete');
      if (deleteBtn) {
        e.stopPropagation();
        if (confirm('Ungroup these tabs?')) {
          await deleteTabGroup(deleteBtn.dataset.groupId);
        }
        return;
      }

      const groupHeader = e.target.closest('.space-folder__header--live');
      if (groupHeader && !e.target.closest('.space-tabgroup-delete')) {
        const gid = groupHeader.dataset.groupId;
        if (gid) {
          const collapsed = await getGroupCollapsed(gid);
          await setGroupCollapsed(gid, !collapsed);
          loadCurrentSpace();
        }
        return;
      }

      const menuBtn = e.target.closest('.space-entry-menu');
      if (menuBtn && menuBtn.dataset.tabId) {
        showTabEntryMenu(e, menuBtn.dataset.tabId, menuBtn.closest('.space-entry--tab')?.dataset.url || '');
        return;
      }

      const entry = e.target.closest('.space-entry--tab');
      if (entry && !e.target.closest('button') && !e.target.classList.contains('tab-checkbox')) {
        const tabId = parseInt(entry.dataset.tabId, 10);
        if (tabId) chrome.tabs.update(tabId, { active: true }).catch(() => {});
      }
    });
  }
}

// OLD function - now replaced by setupEventDelegation (called once on load)
// This prevents memory leaks from listeners being reattached on every render
function attachSpaceEventListeners(space, windowId, allTabs) {
  // Just setup drag-and-drop (still needs to be called on render for new elements)
  setupDragAndDrop();
}

let draggedElement = null;
let draggedData = null;

function setupDragAndDrop() {
  // Make pinnedEntriesList and liveTabsList drop zones
  if (pinnedEntriesList) {
    pinnedEntriesList.dataset.dropZone = 'pinned-section';
    setupDropZone(pinnedEntriesList);
  }
  if (liveTabsList) {
    liveTabsList.dataset.dropZone = 'tabs-section';
    setupDropZone(liveTabsList);
  }

  // Setup draggable entries
  document.querySelectorAll('.space-entry[draggable="true"]').forEach(entry => {
    entry.addEventListener('dragstart', handleDragStart);
    entry.addEventListener('dragend', handleDragEnd);
  });

  // Setup folder drop zones
  document.querySelectorAll('[data-drop-zone="folder"]').forEach(zone => {
    setupDropZone(zone);
  });

  // Setup tab group drop zones
  document.querySelectorAll('[data-drop-zone="tabgroup"]').forEach(zone => {
    setupDropZone(zone);
  });
}

function setupDropZone(element) {
  element.addEventListener('dragover', handleDragOver);
  element.addEventListener('drop', handleDrop);
  element.addEventListener('dragleave', handleDragLeave);
  element.addEventListener('dragenter', handleDragEnter);
}

function handleDragStart(e) {
  draggedElement = e.currentTarget;
  draggedData = {
    type: draggedElement.dataset.type,
    index: draggedElement.dataset.index,
    tabId: draggedElement.dataset.tabId,
    groupId: draggedElement.dataset.groupId,
    url: draggedElement.dataset.url
  };

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', JSON.stringify(draggedData));

  setTimeout(() => {
    if (draggedElement) draggedElement.classList.add('dragging');
  }, 0);
}

function handleDragEnd(e) {
  if (draggedElement) draggedElement.classList.remove('dragging');
  document.querySelectorAll('.drop-zone-active').forEach(el => {
    el.classList.remove('drop-zone-active');
  });
  draggedElement = null;
  draggedData = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  const dropZone = e.currentTarget;
  if (dropZone && dropZone !== draggedElement) {
    dropZone.classList.add('drop-zone-active');
  }
}

function handleDragLeave(e) {
  const dropZone = e.currentTarget;
  if (dropZone && !dropZone.contains(e.relatedTarget)) {
    dropZone.classList.remove('drop-zone-active');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const dropZone = e.currentTarget;
  dropZone.classList.remove('drop-zone-active');

  if (!draggedData) return;

  // Snapshot draggedData immediately — dragend fires concurrently and nulls it
  const data = { ...draggedData };

  const dropZoneType = dropZone.dataset.dropZone;
  const folderIndex = dropZone.dataset.folderIndex;
  const groupId = dropZone.dataset.groupId;

  // Handle different drop scenarios
  if (data.type === 'pinned-entry') {
    const entryUrl = data.url;

    if (dropZoneType === 'folder') {
      // Moving pinned entry to a folder
      await moveEntryToFolder(entryUrl, parseInt(folderIndex, 10));
    } else if (dropZoneType === 'pinned-section') {
      // Moving pinned entry out of folder (to main pinned section)
      await moveEntryToFolder(entryUrl, -1);
    } else if (dropZoneType === 'tabs-section' || dropZoneType === 'tabgroup') {
      // Unpinning entry (moving to tabs)
      await unpinEntry(entryUrl);

      // If dropping on tab group, add to that group
      if (dropZoneType === 'tabgroup' && chrome.tabGroups) {
        const targetGroupId = parseInt(groupId, 10);
        try {
          // Find the tab by URL (after unpinning)
          const tabs = await chrome.tabs.query({ windowId: currentWindowId });
          const tab = tabs.find(t => t.url === entryUrl);
          if (tab) {
            await chrome.tabs.group({ tabIds: tab.id, groupId: targetGroupId });
            loadCurrentSpace();
            schedulePersistCurrentSpace();
          }
        } catch (e) {
          console.error('Failed to add unpinned tab to group:', e);
        }
      }
    }
  } else if (data.type === 'live-tab') {
    const tabId = parseInt(data.tabId, 10);

    if (dropZoneType === 'pinned-section' || dropZoneType === 'folder') {
      if (dropZoneType === 'folder') {
        // Pin without re-rendering, then atomically move into folder
        await pinTab(tabId, { skipRerender: true });
        await moveEntryToFolder(data.url, parseInt(folderIndex, 10));
        // moveEntryToFolder handles loadCurrentSpace + schedulePersistCurrentSpace
      } else {
        await pinTab(tabId);
      }
    } else if (dropZoneType === 'tabgroup' && chrome.tabGroups) {
      // Moving tab to a different group
      const targetGroupId = parseInt(groupId, 10);
      const currentGroupId = data.groupId ? parseInt(data.groupId, 10) : null;

      if (targetGroupId !== currentGroupId) {
        try {
          await chrome.tabs.group({ tabIds: tabId, groupId: targetGroupId });
          loadCurrentSpace();
          schedulePersistCurrentSpace();
        } catch (e) {
          console.error('Failed to move tab to group:', e);
        }
      }
    } else if (dropZoneType === 'tabs-section') {
      // Ungrouping tab (moving to main tabs section)
      if (data.groupId) {
        try {
          await chrome.tabs.ungroup(tabId);
          loadCurrentSpace();
          schedulePersistCurrentSpace();
        } catch (e) {
          console.error('Failed to ungroup tab:', e);
        }
      }
    }
  }
}

async function pinTab(tabId, { skipRerender = false } = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url || !currentSpaceId) return;
  const { spaces = {} } = await chrome.storage.local.get('spaces');
  const space = spaces[currentSpaceId];
  if (!space) return;
  if (!space.pinnedEntries) space.pinnedEntries = [];

  // Check for duplicates and notify user
  if (space.pinnedEntries.some(e => e.url === tab.url)) {
    console.log('[HOME] Tab already pinned:', tab.url);
    showTempNotification('Already pinned to this space');
    return;
  }
  space.pinnedEntries.push({ url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '' });
  await chrome.storage.local.set({ spaces });
  try { await chrome.tabs.update(tabId, { pinned: true }); } catch (_) {}
  if (!skipRerender) {
    loadCurrentSpace();
    schedulePersistCurrentSpace();
  }
}

async function closeTab(tabId) {
  try {
    // Get tab info before closing for undo
    const tab = await chrome.tabs.get(tabId);
    const tabInfo = {
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      index: tab.index,
      pinned: tab.pinned
    };

    // Close the tab
    await chrome.tabs.remove(tabId);

    // Add undo operation
    undoManager.push({
      type: 'close tab',
      data: { tabInfo, windowId: currentWindowId },
      undo: async () => {
        if (currentWindowId) {
          await chrome.tabs.create({
            url: tabInfo.url,
            windowId: currentWindowId,
            index: tabInfo.index,
            pinned: tabInfo.pinned
          });
          loadCurrentSpace();
        }
      }
    });

    loadCurrentSpace();
  } catch (e) {
    console.error('Failed to close tab:', e);
  }
}

async function unpinEntry(entryIndexOrUrl) {
  if (!currentSpaceId) return;
  const { spaces = {} } = await chrome.storage.local.get('spaces');
  const space = spaces[currentSpaceId];
  if (!space || !space.pinnedEntries) return;

  // Accept either a numeric index or a URL string
  let entryIndex, url;
  if (typeof entryIndexOrUrl === 'string') {
    entryIndex = space.pinnedEntries.findIndex(e => e.url === entryIndexOrUrl);
    url = entryIndexOrUrl;
  } else {
    entryIndex = entryIndexOrUrl;
    url = space.pinnedEntries[entryIndex] ? space.pinnedEntries[entryIndex].url : null;
  }
  if (entryIndex < 0 || !space.pinnedEntries[entryIndex]) return;

  // Save for undo
  const removedEntry = { ...space.pinnedEntries[entryIndex] };
  const removedFromFolders = [];
  (space.pinnedFolders || []).forEach((f, fi) => {
    if (f.entryUrls && f.entryUrls.includes(url)) {
      removedFromFolders.push(fi);
    }
  });

  space.pinnedEntries.splice(entryIndex, 1);
  (space.pinnedFolders || []).forEach(f => {
    f.entryUrls = (f.entryUrls || []).filter(u => u !== url);
  });
  await chrome.storage.local.set({ spaces });
  if (currentWindowId && url) {
    const tabs = await chrome.tabs.query({ windowId: currentWindowId });
    const t = tabs.find(x => x.url === url);
    if (t) try { await chrome.tabs.update(t.id, { pinned: false }); } catch (_) {}
  }

  // Add undo operation
  undoManager.push({
    type: 'unpin entry',
    data: { spaceId: currentSpaceId, entry: removedEntry, index: entryIndex, folders: removedFromFolders },
    undo: async () => {
      const { spaces = {} } = await chrome.storage.local.get('spaces');
      const sp = spaces[currentSpaceId];
      if (sp) {
        if (!sp.pinnedEntries) sp.pinnedEntries = [];
        sp.pinnedEntries.splice(entryIndex, 0, removedEntry);
        // Restore to folders
        removedFromFolders.forEach(fi => {
          if (sp.pinnedFolders && sp.pinnedFolders[fi]) {
            if (!sp.pinnedFolders[fi].entryUrls) sp.pinnedFolders[fi].entryUrls = [];
            if (!sp.pinnedFolders[fi].entryUrls.includes(removedEntry.url)) {
              sp.pinnedFolders[fi].entryUrls.push(removedEntry.url);
            }
          }
        });
        await chrome.storage.local.set({ spaces });
        loadCurrentSpace();
      }
    }
  });

  loadCurrentSpace();
  schedulePersistCurrentSpace();
}

async function createPinnedFolder(name) {
  if (!currentSpaceId) return;
  const { spaces = {} } = await chrome.storage.local.get('spaces');
  const space = spaces[currentSpaceId];
  if (!space) return;
  if (!space.pinnedFolders) space.pinnedFolders = [];
  space.pinnedFolders.push({
    name,
    entryUrls: [],
    collapsed: false
  });
  await chrome.storage.local.set({ spaces });
  loadCurrentSpace();
  schedulePersistCurrentSpace();
}

async function deletePinnedFolder(folderIndex) {
  if (!currentSpaceId || folderIndex < 0) return;
  const { spaces = {} } = await chrome.storage.local.get('spaces');
  const space = spaces[currentSpaceId];
  if (!space || !space.pinnedFolders || !space.pinnedFolders[folderIndex]) return;

  // Remove the folder (entries stay in pinnedEntries, just not in any folder)
  space.pinnedFolders.splice(folderIndex, 1);
  await chrome.storage.local.set({ spaces });
  loadCurrentSpace();
  schedulePersistCurrentSpace();
}

async function moveEntryToFolder(entryUrl, folderIndex) {
  if (!currentSpaceId || !entryUrl) return;
  const { spaces = {} } = await chrome.storage.local.get('spaces');
  const space = spaces[currentSpaceId];
  if (!space) return;

  // Remove entry from all folders first
  (space.pinnedFolders || []).forEach(f => {
    f.entryUrls = (f.entryUrls || []).filter(u => u !== entryUrl);
  });

  // Add to target folder (if folderIndex >= 0)
  if (folderIndex >= 0 && space.pinnedFolders && space.pinnedFolders[folderIndex]) {
    if (!space.pinnedFolders[folderIndex].entryUrls) {
      space.pinnedFolders[folderIndex].entryUrls = [];
    }
    if (!space.pinnedFolders[folderIndex].entryUrls.includes(entryUrl)) {
      space.pinnedFolders[folderIndex].entryUrls.push(entryUrl);
    }
  }

  await chrome.storage.local.set({ spaces });
  loadCurrentSpace();
  schedulePersistCurrentSpace();
}

async function createTabGroup(name) {
  if (!currentWindowId || !chrome.tabGroups) return;

  // Get active tab to add to the new group
  const tabs = await chrome.tabs.query({ windowId: currentWindowId, active: true });
  if (tabs.length === 0) return;

  try {
    const groupId = await chrome.tabs.group({ tabIds: tabs[0].id });
    await chrome.tabGroups.update(groupId, { title: name });
    loadCurrentSpace();
    schedulePersistCurrentSpace();
  } catch (e) {
    console.error('Failed to create tab group:', e);
  }
}

async function deleteTabGroup(groupId) {
  if (!chrome.tabGroups) return;
  try {
    const tabs = await chrome.tabs.query({ groupId: parseInt(groupId, 10) });
    const tabIds = tabs.map(t => t.id);
    if (tabIds.length > 0) {
      await chrome.tabs.ungroup(tabIds);
    }
    loadCurrentSpace();
    schedulePersistCurrentSpace();
  } catch (e) {
    console.error('Failed to delete tab group:', e);
  }
}

$('#newTabBtn').addEventListener('click', async () => {
  if (currentWindowId) try { await chrome.tabs.create({ windowId: currentWindowId }); } catch (_) {}
  loadCurrentSpace();
  schedulePersistCurrentSpace();
});

$('#newPinnedFolderBtn').addEventListener('click', async () => {
  const name = window.prompt('Folder name:', 'New Folder');
  if (!name || !name.trim()) return;
  await createPinnedFolder(name.trim());
});

$('#newTabGroupBtn').addEventListener('click', async () => {
  const name = window.prompt('Tab group name:', 'New Group');
  if (!name || !name.trim()) return;
  await createTabGroup(name.trim());
});

$('#saveAsNewSpace').addEventListener('click', () => {
  openSpaceTemplateModal();
});

function openSpaceTemplateModal() {
  const modal = $('#spaceTemplateModal');
  const nameInput = $('#spaceTemplateNameInput');
  const grid = $('#templateGrid');

  // Reset state
  nameInput.value = '';
  delete nameInput.dataset.lastAutoFill;
  grid.querySelectorAll('.template-card').forEach(c => c.classList.remove('template-card--selected'));
  const blank = grid.querySelector('.template-card[data-name=""]');
  if (blank) blank.classList.add('template-card--selected');

  modal.hidden = false;
  setTimeout(() => nameInput.focus(), 50);
}

function closeSpaceTemplateModal() {
  $('#spaceTemplateModal').hidden = true;
}

$('#templateGrid').addEventListener('click', e => {
  const card = e.target.closest('.template-card');
  if (!card) return;
  $('#templateGrid').querySelectorAll('.template-card').forEach(c => c.classList.remove('template-card--selected'));
  card.classList.add('template-card--selected');
  // Auto-fill name only if user hasn't typed their own
  const nameInput = $('#spaceTemplateNameInput');
  const tplName = card.dataset.name || '';
  if (!nameInput.value || nameInput.value === nameInput.dataset.lastAutoFill) {
    nameInput.value = tplName;
    nameInput.dataset.lastAutoFill = tplName;
  }
});

$('#spaceTemplateClose').addEventListener('click', closeSpaceTemplateModal);
$('#spaceTemplateCancel').addEventListener('click', closeSpaceTemplateModal);
$('#spaceTemplateModal').addEventListener('click', e => {
  if (e.target === $('#spaceTemplateModal')) closeSpaceTemplateModal();
});

$('#spaceTemplateConfirm').addEventListener('click', async () => {
  const nameInput = $('#spaceTemplateNameInput');
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  const selected = $('#templateGrid').querySelector('.template-card--selected');
  const emoji = selected ? (selected.dataset.emoji || '') : '';
  closeSpaceTemplateModal();
  await createSavedSpaceFromCurrent(name, emoji);
});

$('#spaceTemplateNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#spaceTemplateConfirm').click();
  if (e.key === 'Escape') closeSpaceTemplateModal();
});

async function createSavedSpaceFromCurrent(name, emoji = '') {
  const { space } = await getOrCreateCurrentSpace();
  if (!space) return;
  const win = await chrome.windows.getLastFocused();
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const pinnedUrls = new Set((space.pinnedEntries || []).map(e => e.url));
  const unpinnedTabs = tabs.filter(t => t.url && !pinnedUrls.has(t.url)).map(t => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl || '' }));

  let folders = [];
  if (chrome.tabGroups) {
    try {
      const groups = await chrome.tabGroups.query({ windowId: win.id });
      const regular = tabs.filter(t => !t.pinned && !pinnedUrls.has(t.url));
      for (const g of groups) {
        const indices = [];
        regular.forEach((t, i) => { if (t.groupId === g.id) indices.push(i); });
        if (indices.length) folders.push({ id: g.id, name: (g.title && g.title.trim()) || 'Unnamed', tabIndices: indices });
      }
    } catch (_) {}
  }

  const snapshot = {
    id: 'saved_' + Date.now(),
    name,
    emoji: String(emoji).trim().slice(0, 4),
    pinnedTabs: (space.pinnedEntries || []).slice(),
    tabs: unpinnedTabs,
    folders,
    sections: space.sections || ['github', 'slack', 'calendar'],
    theme: space.theme || { primary: '#5c6bc0', background: '#f5f0e8', surface: '#faf7f2', accent: '#3f51b5' },
    createdAt: new Date().toISOString(),
    saved: true
  };

  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  workspaces.push(snapshot);
  await chrome.storage.local.set({ workspaces });
  loadSavedSpaces();
}

// Emoji picker: curated list for spaces
const EMOJI_PICKER_LIST = ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','🤗','🤔','😎','🥳','😤','😢','😭','😡','💪','👍','👋','🙌','👏','💼','📁','📂','📌','📎','💡','🔥','⭐','✨','🎯','🚀','🏠','🏢','💻','📱','🎨','📚','🔬','🌍','🌈','☀️','🌙','❤️','💜','💙','🟢','🟡','🔴','⚫','📧','📬','🗓️','⏰','🎵','🎮','☕','🍕','🌮','🏃','🧘','🎉','🔔','📋','✅','❌'];

function buildEmojiPicker(containerId, onSelect) {
  const container = $(containerId);
  if (!container || container.dataset.built) return;
  container.dataset.built = 'true';
  container.innerHTML = EMOJI_PICKER_LIST.map(emoji =>
    `<button type="button" class="emoji-picker__item" data-emoji="${escapeHtml(emoji)}" role="option">${escapeHtml(emoji)}</button>`
  ).join('');
  container.hidden = true; // always start hidden; only show when trigger is clicked
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-picker__item');
    if (btn && btn.dataset.emoji) {
      onSelect(btn.dataset.emoji);
    }
  });
}

// Edit current space (name, emoji)
const editSpaceForm = $('#editSpaceForm');
const editSpaceEmoji = $('#editSpaceEmoji');
const editSpaceEmojiDisplay = $('#editSpaceEmojiDisplay');
const editSpaceEmojiBtn = $('#editSpaceEmojiBtn');
const editSpaceEmojiPicker = $('#editSpaceEmojiPicker');
const editSpaceName = $('#editSpaceName');

buildEmojiPicker('#editSpaceEmojiPicker', (emoji) => {
  if (editSpaceEmoji) editSpaceEmoji.value = emoji;
  if (editSpaceEmojiDisplay) editSpaceEmojiDisplay.textContent = emoji;
  if (editSpaceEmojiPicker) editSpaceEmojiPicker.hidden = true;
});

if (editSpaceEmojiBtn && editSpaceEmojiPicker) {
  editSpaceEmojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const wasHidden = editSpaceEmojiPicker.hidden;
    editSpaceEmojiPicker.hidden = !wasHidden; // show only when trigger clicked, hide when clicked again
    if (!editSpaceEmojiPicker.hidden) {
      const closePicker = (e2) => {
        if (!editSpaceEmojiPicker.contains(e2.target) && !editSpaceEmojiBtn.contains(e2.target)) {
          editSpaceEmojiPicker.hidden = true;
          document.removeEventListener('click', closePicker);
        }
      };
      setTimeout(() => document.addEventListener('click', closePicker), 0);
    }
  });
}

$('#editCurrentSpace').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!currentSpaceId) return;
  const { spaces = {} } = await chrome.storage.local.get('spaces');
  const space = normalizeSpace(spaces[currentSpaceId]);
  if (!space) return;
  const emojiVal = (space.emoji && space.emoji.trim()) || '😀';
  if (editSpaceEmoji) editSpaceEmoji.value = emojiVal;
  if (editSpaceEmojiDisplay) editSpaceEmojiDisplay.textContent = emojiVal;
  if (editSpaceEmojiPicker) editSpaceEmojiPicker.hidden = true;
  if (editSpaceName) editSpaceName.value = space.name || '';

  // Set section checkboxes
  const sections = space.sections || ['github', 'slack', 'calendar'];
  $('#editSpaceSectionGithub').checked = sections.includes('github');
  $('#editSpaceSectionSlack').checked = sections.includes('slack');
  $('#editSpaceSectionCalendar').checked = sections.includes('calendar');

  // Set auto-archive hours
  const autoArchiveHours = space.autoArchiveHours || 0;
  if ($('#editSpaceAutoArchiveHours')) $('#editSpaceAutoArchiveHours').value = autoArchiveHours;

  // Set theme colors
  const theme = space.theme || { primary: '#5c6bc0', background: '#f5f0e8', surface: '#faf7f2', accent: '#3f51b5' };
  if ($('#editSpaceThemePrimary')) $('#editSpaceThemePrimary').value = theme.primary;
  if ($('#editSpaceThemeBackground')) $('#editSpaceThemeBackground').value = theme.background;
  if ($('#editSpaceThemeSurface')) $('#editSpaceThemeSurface').value = theme.surface;
  if ($('#editSpaceThemeAccent')) $('#editSpaceThemeAccent').value = theme.accent;

  // Mark active preset
  $$('.theme-preset').forEach(btn => {
    const p = themePresets[btn.dataset.preset];
    const isActive = p && p.background === theme.background && p.primary === theme.primary;
    btn.classList.toggle('theme-preset--active', isActive);
  });

  if (editSpaceForm) {
    editSpaceForm.hidden = false;
    if (editSpaceName) editSpaceName.focus();
    const closeOnOutside = (e2) => {
      if (editSpaceForm && !editSpaceForm.contains(e2.target) && !e2.target.closest('#editCurrentSpace')) {
        editSpaceForm.hidden = true;
        if (editSpaceEmojiPicker) editSpaceEmojiPicker.hidden = true;
        document.removeEventListener('click', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
  }
});

$('#editSpaceCancel').addEventListener('click', () => {
  if (editSpaceForm) editSpaceForm.hidden = true;
});

$('#editSpaceSave').addEventListener('click', async () => {
  if (!currentSpaceId) return;
  const name = (editSpaceName && editSpaceName.value.trim()) || '';
  if (!name) {
    if (editSpaceName) editSpaceName.focus();
    return;
  }
  const emoji = (editSpaceEmoji && editSpaceEmoji.value.trim().slice(0, 4)) || '';

  // Get selected sections
  const sections = [];
  if ($('#editSpaceSectionGithub').checked) sections.push('github');
  if ($('#editSpaceSectionSlack').checked) sections.push('slack');
  if ($('#editSpaceSectionCalendar').checked) sections.push('calendar');

  // Get theme colors
  const theme = {
    primary: $('#editSpaceThemePrimary')?.value || '#6366f1',
    background: $('#editSpaceThemeBackground')?.value || '#0f1117',
    surface: $('#editSpaceThemeSurface')?.value || '#1a1d27',
    accent: $('#editSpaceThemeAccent')?.value || '#818cf8'
  };

  // Get auto-archive hours
  const autoArchiveHours = parseInt($('#editSpaceAutoArchiveHours')?.value || '0', 10);

  const { spaces = {}, workspaces = [] } = await chrome.storage.local.get(['spaces', 'workspaces']);
  const space = spaces[currentSpaceId];
  if (space) {
    space.name = name;
    space.emoji = emoji;
    space.sections = sections;
    space.theme = theme;
    space.autoArchiveHours = autoArchiveHours;
  }
  const wsIndex = workspaces.findIndex(w => w.id === currentSpaceId);
  if (wsIndex >= 0) {
    workspaces[wsIndex].name = name;
    workspaces[wsIndex].emoji = emoji;
    workspaces[wsIndex].sections = sections;
    workspaces[wsIndex].theme = theme;
    workspaces[wsIndex].autoArchiveHours = autoArchiveHours;
  }
  await chrome.storage.local.set({ spaces, workspaces });
  if (editSpaceForm) editSpaceForm.hidden = true;
  loadCurrentSpace();
  loadSavedSpaces();
});

// Theme preset handlers
const themePresets = {
  // ── Light themes ──
  paper:  { primary: '#5c6bc0', background: '#f5f0e8', surface: '#faf7f2', accent: '#3f51b5' },
  linen:  { primary: '#b45309', background: '#fdf6ec', surface: '#fffbf5', accent: '#d97706' },
  sage:   { primary: '#4a7c59', background: '#f0f4f0', surface: '#f7faf7', accent: '#38695a' },
  dusk:   { primary: '#4f6eb5', background: '#eef1f7', surface: '#f5f7fc', accent: '#3b5ea6' },
  peach:  { primary: '#c2552a', background: '#fdf0ea', surface: '#fdf6f2', accent: '#d4622e' },
  // ── Dark themes ──
  dark:   { primary: '#818cf8', background: '#0f1117', surface: '#1a1d27', accent: '#6366f1' },
  ocean:  { primary: '#38bdf8', background: '#0c1821', surface: '#162534', accent: '#0ea5e9' },
  forest: { primary: '#34d399', background: '#0d1f16', surface: '#182e20', accent: '#10b981' },
  sunset: { primary: '#fbbf24', background: '#1c1208', surface: '#2a1e10', accent: '#f59e0b' },
  rose:   { primary: '#fb7185', background: '#1a0d12', surface: '#2a1520', accent: '#f43f5e' },
  purple: { primary: '#c084fc', background: '#130d1c', surface: '#221630', accent: '#a855f7' },
};

$$('.theme-preset').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const preset = btn.dataset.preset;
    const theme = themePresets[preset];
    if (theme && $('#editSpaceThemePrimary')) {
      $('#editSpaceThemePrimary').value = theme.primary;
      $('#editSpaceThemeBackground').value = theme.background;
      $('#editSpaceThemeSurface').value = theme.surface;
      $('#editSpaceThemeAccent').value = theme.accent;
      $$('.theme-preset').forEach(b => b.classList.remove('theme-preset--active'));
      btn.classList.add('theme-preset--active');
    }
  });
});

function normalizeWorkspace(ws) {
  return {
    ...ws,
    emoji: typeof ws.emoji === 'string' ? [...ws.emoji.trim()].slice(0, 2).join('') : '',
    pinnedTabs: Array.isArray(ws.pinnedTabs) ? ws.pinnedTabs : [],
    tabs: Array.isArray(ws.tabs) ? ws.tabs : [],
    folders: Array.isArray(ws.folders) ? ws.folders : [],
    sections: Array.isArray(ws.sections) ? ws.sections : ['github', 'slack', 'calendar'],
    theme: ws.theme || { primary: '#5c6bc0', background: '#f5f0e8', surface: '#faf7f2', accent: '#3f51b5' }
  };
}

async function restoreSavedSpace(ws, inNewWindow) {
  const pinnedList = ws.pinnedTabs || [];
  const regularList = ws.tabs || [];
  const allTabs = [...pinnedList, ...regularList];
  if (allTabs.length === 0 && !inNewWindow) return;

  let win;
  if (inNewWindow) {
    const first = allTabs[0];
    win = await chrome.windows.create(first && first.url ? { url: first.url } : {});
    const createdIds = [];
    const initialTabs = await chrome.tabs.query({ windowId: win.id });
    if (initialTabs.length) createdIds.push(initialTabs[0].id);
    for (let i = 1; i < allTabs.length; i++) {
      const tab = allTabs[i];
      if (!tab.url) continue;
      const created = await chrome.tabs.create({ url: tab.url, windowId: win.id });
      createdIds.push(created.id);
    }
    const pinnedCount = pinnedList.length;
    for (let i = 0; i < pinnedCount && i < createdIds.length; i++) {
      try { await chrome.tabs.update(createdIds[i], { pinned: true }); } catch (_) {}
    }
    if (chrome.tabGroups && ws.folders && ws.folders.length) {
      for (const folder of ws.folders) {
        const tabIds = (folder.tabIndices || []).map(i => createdIds[pinnedCount + i]).filter(Boolean);
        if (tabIds.length) try { const gid = await chrome.tabs.group({ tabIds }); await chrome.tabGroups.update(gid, { title: folder.name }); } catch (_) {}
      }
    }
    const spaceId = 'space_' + Date.now();
    const space = {
      id: spaceId,
      name: ws.name,
      emoji: ws.emoji || '',
      pinnedEntries: (ws.pinnedTabs || []).slice(),
      pinnedFolders: [],
      sections: ws.sections || ['github', 'slack', 'calendar'],
      autoArchiveHours: 12,
      saved: false,
      createdAt: new Date().toISOString()
    };
    const { spaces = {}, windowIdToSpaceId = {} } = await chrome.storage.local.get(['spaces', 'windowIdToSpaceId']);
    spaces[spaceId] = space;
    windowIdToSpaceId[win.id] = spaceId;
    await chrome.storage.local.set({ spaces, windowIdToSpaceId });
    loadCurrentSpace();
    loadSavedSpaces();
    return;
  }

  win = await chrome.windows.getLastFocused();
  const existing = await chrome.tabs.query({ windowId: win.id });
  const existingIds = existing.map(t => t.id).filter(Boolean);

  const createdIds = [];

  // SAFE APPROACH: Create first tab BEFORE removing any tabs
  if (allTabs.length > 0 && allTabs[0].url) {
    const firstTab = await chrome.tabs.create({
      url: allTabs[0].url,
      windowId: win.id
    });
    createdIds.push(firstTab.id);
  }

  // Now safe to remove old tabs (Chrome won't close because we have ≥1 tab)
  if (existingIds.length > 0) {
    await chrome.tabs.remove(existingIds);
  }

  // Create remaining tabs
  for (let i = 1; i < allTabs.length; i++) {
    const tab = allTabs[i];
    if (!tab.url) continue;
    const created = await chrome.tabs.create({
      url: tab.url,
      windowId: win.id
    });
    createdIds.push(created.id);
  }
  const pinnedCount = pinnedList.length;
  for (let i = 0; i < pinnedCount && i < createdIds.length; i++) {
    try { await chrome.tabs.update(createdIds[i], { pinned: true }); } catch (_) {}
  }
  if (chrome.tabGroups && ws.folders && ws.folders.length) {
    for (const folder of ws.folders) {
      const tabIds = (folder.tabIndices || []).map(i => createdIds[pinnedCount + i]).filter(Boolean);
      if (tabIds.length) try { const gid = await chrome.tabs.group({ tabIds }); await chrome.tabGroups.update(gid, { title: folder.name }); } catch (_) {}
    }
  }
  const spaceId = ws.id;
  const { spaces = {}, windowIdToSpaceId = {} } = await chrome.storage.local.get(['spaces', 'windowIdToSpaceId']);
  if (!spaces[spaceId]) {
    spaces[spaceId] = {
      id: spaceId,
      name: ws.name,
      emoji: ws.emoji || '',
      pinnedEntries: (ws.pinnedTabs || []).slice(),
      pinnedFolders: [],
      sections: ws.sections || ['github', 'slack', 'calendar'],
      autoArchiveHours: 12,
      saved: true,
      createdAt: ws.createdAt
    };
  } else {
    spaces[spaceId].name = ws.name;
    spaces[spaceId].emoji = ws.emoji || '';
    spaces[spaceId].sections = ws.sections || ['github', 'slack', 'calendar'];
  }
  windowIdToSpaceId[win.id] = spaceId;
  await chrome.storage.local.set({ spaces, windowIdToSpaceId, lastActiveWorkspaceId: ws.id });
  currentSpaceId = spaceId;
  currentWindowId = win.id;
  loadCurrentSpace();
  loadSavedSpaces();
}

async function switchToSpace(ws) {
  // If already viewing this space, do nothing
  if (currentSpaceId === ws.id) return;

  // Get current window
  const win = await chrome.windows.getLastFocused();
  if (!win || win.id == null) return;

  // IMPORTANT: Save the current space's tabs BEFORE switching
  // This prevents the old space's tabs from being saved to the new space
  if (currentSpaceId) {
    await persistCurrentSpaceSnapshot({ showFeedback: false });
  }

  // Immediately load the new space's tabs in current window (Arc-like behavior)
  // This prevents the dangerous window where currentSpaceId != actual tabs
  await restoreSavedSpaceFromId(ws.id, false);

  // Note: restoreSavedSpace already updates currentSpaceId, windowIdToSpaceId,
  // and calls loadCurrentSpace() and loadSavedSpaces(), so we're done!
}

function showOpenTabsBanner(ws) {
  // Remove any existing banner
  const existing = document.getElementById('openTabsBanner');
  if (existing) existing.remove();

  const tabCount = (ws.pinnedTabs || []).length + (ws.tabs || []).length;
  if (tabCount === 0) return;

  const banner = document.createElement('div');
  banner.id = 'openTabsBanner';
  banner.className = 'open-tabs-banner';
  banner.innerHTML = `
    <span class="open-tabs-banner__text">Open ${tabCount} saved tab${tabCount !== 1 ? 's' : ''} for <strong></strong>?</span>
    <div class="open-tabs-banner__actions">
      <button class="open-tabs-banner__btn open-tabs-banner__btn--current">Current window</button>
      <button class="open-tabs-banner__btn open-tabs-banner__btn--new">New window</button>
      <button class="open-tabs-banner__btn open-tabs-banner__btn--dismiss">Dismiss</button>
    </div>
  `;
  banner.querySelector('strong').textContent = ws.name;

  // Insert after chip bar
  const chipBar = document.getElementById('spacesEmojiRow');
  if (chipBar && chipBar.nextSibling) {
    chipBar.parentNode.insertBefore(banner, chipBar.nextSibling);
  } else {
    document.body.prepend(banner);
  }

  banner.querySelector('.open-tabs-banner__btn--current').addEventListener('click', async () => {
    banner.remove();
    // Save current space's tabs before switching to prevent data contamination
    if (currentSpaceId && currentSpaceId !== ws.id) {
      await persistCurrentSpaceSnapshot({ showFeedback: false });
    }
    await restoreSavedSpaceFromId(ws.id, false);  // false = current window
  });
  banner.querySelector('.open-tabs-banner__btn--new').addEventListener('click', async () => {
    banner.remove();
    // Save current space's tabs before opening in new window
    if (currentSpaceId && currentSpaceId !== ws.id) {
      await persistCurrentSpaceSnapshot({ showFeedback: false });
    }
    await restoreSavedSpaceFromId(ws.id, true);  // true = new window
  });
  banner.querySelector('.open-tabs-banner__btn--dismiss').addEventListener('click', () => {
    banner.remove();
  });

  // Auto-dismiss after 8s
  setTimeout(() => { if (banner.isConnected) banner.remove(); }, 8000);
}

function showTempNotification(message, duration = 2500) {
  const existing = document.getElementById('tempNotification');
  if (existing) existing.remove();
  const n = document.createElement('div');
  n.id = 'tempNotification';
  n.className = 'toast';
  n.textContent = message;
  document.body.appendChild(n);
  setTimeout(() => {
    if (n.isConnected) { n.classList.add('toast--out'); setTimeout(() => n.remove(), 300); }
  }, duration);
}

function showStorageWarning(usagePercent, usageBytes, quotaBytes) {
  // Don't show if already shown recently
  const lastShown = sessionStorage.getItem('storageWarningShown');
  if (lastShown && Date.now() - parseInt(lastShown) < 60 * 60 * 1000) return; // Once per hour

  // Remove any existing warning
  const existing = document.getElementById('storageWarningBanner');
  if (existing) existing.remove();

  const usageMB = (usageBytes / 1024 / 1024).toFixed(2);
  const quotaMB = (quotaBytes / 1024 / 1024).toFixed(2);

  const banner = document.createElement('div');
  banner.id = 'storageWarningBanner';
  banner.className = 'open-tabs-banner';
  banner.style.borderLeft = '4px solid #f59e0b'; // Warning color
  banner.innerHTML = `
    <span class="open-tabs-banner__text">⚠️ Storage at ${usagePercent.toFixed(1)}% capacity (${usageMB}MB / ${quotaMB}MB). Consider deleting old workspaces.</span>
    <div class="open-tabs-banner__actions">
      <button class="open-tabs-banner__btn open-tabs-banner__btn--dismiss">Dismiss</button>
    </div>
  `;

  // Insert at top
  const chipBar = document.getElementById('spacesEmojiRow');
  if (chipBar && chipBar.nextSibling) {
    chipBar.parentNode.insertBefore(banner, chipBar.nextSibling);
  } else {
    document.body.prepend(banner);
  }

  banner.querySelector('.open-tabs-banner__btn--dismiss').addEventListener('click', () => {
    banner.remove();
    sessionStorage.setItem('storageWarningShown', Date.now().toString());
  });

  // Auto-dismiss after 15s
  setTimeout(() => { if (banner.isConnected) banner.remove(); }, 15000);
}

async function deleteSpace(spaceId) {
  // Remove from workspaces array
  const { workspaces = [], spaces = {}, windowIdToSpaceId = {} } = await chrome.storage.local.get(['workspaces', 'spaces', 'windowIdToSpaceId']);

  const updatedWorkspaces = workspaces.filter(w => w.id !== spaceId);

  // Remove from spaces object
  delete spaces[spaceId];

  // Clean up window mappings that point to this space
  const windowIdsToRemap = [];
  for (const [winId, sId] of Object.entries(windowIdToSpaceId)) {
    if (sId === spaceId) {
      windowIdsToRemap.push(parseInt(winId, 10));
      delete windowIdToSpaceId[winId];
    }
  }

  await chrome.storage.local.set({ workspaces: updatedWorkspaces, spaces, windowIdToSpaceId });

  // If the current window was using this space, create a new one
  if (currentSpaceId === spaceId) {
    currentSpaceId = null;
    currentWindowId = null;
    await loadCurrentSpace(); // This will create a new space for the current window
  }

  loadSavedSpaces();
}

async function loadSavedSpaces() {
  const { workspaces: raw = [] } = await chrome.storage.local.get('workspaces');
  const workspaces = raw.map(normalizeWorkspace);

  // Emoji row: saved space pills (click = switch, right-click = menu)
  if (spacesEmojiRow) {
    if (workspaces.length === 0) {
      spacesEmojiRow.innerHTML = '';
      spacesEmojiRow.hidden = true;
    } else {
      spacesEmojiRow.hidden = false;
      spacesEmojiRow.innerHTML = '';
      workspaces.forEach(ws => {
        const hasEmoji = ws.emoji && ws.emoji.trim().length > 0;
        const tabCount = (ws.pinnedTabs || []).length + (ws.tabs || []).length;
        const isActive = ws.id === currentSpaceId;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `space-chip${isActive ? ' space-chip--active' : ''}`;
        chip.dataset.id = ws.id;
        chip.dataset.name = ws.name;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'space-chip__name';
        nameSpan.textContent = ws.name;

        if (hasEmoji) {
          const emojiSpan = document.createElement('span');
          emojiSpan.className = 'space-chip__emoji';
          emojiSpan.setAttribute('aria-hidden', 'true');
          emojiSpan.textContent = ws.emoji;
          chip.appendChild(emojiSpan);
        }
        chip.appendChild(nameSpan);

        if (tabCount > 0) {
          const countSpan = document.createElement('span');
          countSpan.className = 'space-chip__count';
          countSpan.textContent = tabCount;
          chip.appendChild(countSpan);
        }

        chip.insertAdjacentHTML('beforeend', `
          <span class="space-chip__actions">
            <span class="space-chip__action" data-chip-action="open" title="Open in new window">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </span>
            <span class="space-chip__action space-chip__action--danger" data-chip-action="delete" title="Delete space">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </span>
          </span>
        `);

        spacesEmojiRow.appendChild(chip);
      });
    }
  }

  if (workspaces.length === 0) return;

  // Space chips: left-click = switch, inline action buttons, right-click = full menu
  if (spacesEmojiRow) {
    spacesEmojiRow.querySelectorAll('.space-chip').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-chip-action]');
        if (action) {
          e.stopPropagation();
          const ws = workspaces.find(w => w.id === btn.dataset.id);
          if (!ws) return;
          if (action.dataset.chipAction === 'open') {
            await restoreSavedSpaceFromId(ws.id, true);
          } else if (action.dataset.chipAction === 'delete') {
            if (!confirm(`Delete space "${ws.name}"? This cannot be undone.`)) return;
            await deleteSpace(ws.id);
          }
          return;
        }
        if (e.button !== 0) return;
        const ws = workspaces.find(w => w.id === btn.dataset.id);
        if (ws) {
          await switchToSpace(ws);
          // Banner removed - tabs now switch immediately (Arc-like behavior)
        }
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const ws = workspaces.find(w => w.id === btn.dataset.id);
        if (!ws) return;
        showSpacePillMenu(e.clientX, e.clientY, ws);
      });
    });

    // Add new-space button if not already present
    if (!document.getElementById('sidebarNewSpaceBtn')) {
      const newBtn = document.createElement('button');
      newBtn.id = 'sidebarNewSpaceBtn';
      newBtn.type = 'button';
      newBtn.className = 'sidebar-new-btn';
      newBtn.title = 'New Space';
      newBtn.textContent = '+';
      newBtn.addEventListener('click', openSpaceTemplateModal);
      spacesEmojiRow.appendChild(newBtn);
    }
  }
}

function showSpacePillMenu(x, y, ws) {
  const existing = $('#spacePillMenu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'spacePillMenu';
  menu.className = 'space-pill-menu';
  menu.innerHTML = `
    <button type="button" class="space-pill-menu__item" data-action="new-window">Open in new window</button>
    <button type="button" class="space-pill-menu__item" data-action="duplicate">Duplicate</button>
    <button type="button" class="space-pill-menu__item" data-action="rename">Rename</button>
    <button type="button" class="space-pill-menu__item" data-action="export">Export</button>
    <div class="space-pill-menu__divider"></div>
    <button type="button" class="space-pill-menu__item space-pill-menu__item--danger" data-action="delete">Delete</button>
  `;
  menu.style.position = 'fixed';
  menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  menu.style.top = `${y}px`;
  menu.style.zIndex = '1000';
  document.body.appendChild(menu);

  const close = () => {
    menu.remove();
    document.removeEventListener('click', close);
  };
  document.addEventListener('click', close, { once: true });

  menu.querySelector('[data-action="new-window"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    close();
    await restoreSavedSpaceFromId(ws.id, true);
  });
  menu.querySelector('[data-action="duplicate"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    close();
    await duplicateSpace(ws);
  });
  menu.querySelector('[data-action="rename"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    close();
    const raw = prompt('Rename space:', ws.name);
    if (!raw || !raw.trim()) return;
    const { emoji, name } = parseEmojiName(raw.trim());
    const { workspaces = [], spaces = {} } = await chrome.storage.local.get(['workspaces', 'spaces']);
    const wsIdx = workspaces.findIndex(w => w.id === ws.id);
    if (wsIdx !== -1) {
      workspaces[wsIdx].name = name || workspaces[wsIdx].name;
      if (emoji) workspaces[wsIdx].emoji = emoji;
    }
    if (spaces[ws.id]) {
      spaces[ws.id].name = name || spaces[ws.id].name;
      if (emoji) spaces[ws.id].emoji = emoji;
    }
    await chrome.storage.local.set({ workspaces, spaces });
    loadSavedSpaces();
    if (ws.id === currentSpaceId) loadCurrentSpace();
  });
  menu.querySelector('[data-action="export"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    close();
    exportSpace(ws);
  });
  menu.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    close();
    if (!confirm(`Delete space "${ws.name}"? This cannot be undone.`)) return;
    await deleteSpace(ws.id);
  });
}

async function duplicateSpace(ws) {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const copy = JSON.parse(JSON.stringify(ws));
  copy.id = 'saved_' + Date.now();
  copy.name = ws.name + ' (copy)';
  copy.createdAt = new Date().toISOString();
  workspaces.push(copy);
  await chrome.storage.local.set({ workspaces });
  loadSavedSpaces();
}

function exportSpace(ws) {
  const blob = new Blob([JSON.stringify([ws], null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `home-space-${ws.name.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportAllWorkspaces() {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const blob = new Blob([JSON.stringify(workspaces, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `home-all-workspaces-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importWorkspaces() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;

      const text = await file.text();
      const imported = JSON.parse(text);

      if (!Array.isArray(imported)) {
        alert('Invalid file format. Expected an array of workspaces.');
        return;
      }

      const { workspaces = [] } = await chrome.storage.local.get('workspaces');

      // Check for duplicates and rename if needed
      imported.forEach(ws => {
        const existingIds = workspaces.map(w => w.id);
        if (existingIds.includes(ws.id)) {
          ws.id = 'saved_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          ws.name = ws.name + ' (imported)';
        }
      });

      workspaces.push(...imported);
      await chrome.storage.local.set({ workspaces });
      loadSavedSpaces();

      alert(`Successfully imported ${imported.length} workspace${imported.length !== 1 ? 's' : ''}`);
    } catch (e) {
      console.error('Import failed:', e);
      alert('Failed to import workspaces: ' + e.message);
    }
  });
  input.click();
}

function parseEmojiName(input) {
  const emojiMatch = input.match(/^(\p{Extended_Pictographic}[\uFE0F\u20D0-\u20FF]?\s*)/u);
  if (emojiMatch) {
    return { emoji: emojiMatch[1].trim(), name: input.slice(emojiMatch[1].length).trim() };
  }
  return { emoji: '', name: input };
}

async function restoreSavedSpaceFromId(workspaceId, inNewWindow) {
  const { workspaces: list = [] } = await chrome.storage.local.get('workspaces');
  const ws = list.find(w => w.id === workspaceId);
  if (!ws) return;
  const workspaces = list.map(normalizeWorkspace);
  const normalized = workspaces.find(w => w.id === workspaceId);
  if (normalized) await restoreSavedSpace(normalized, inNewWindow);
}

// ════════════════════════════════════
//  SERVICE SCRAPING (GitHub/Slack/Cal)
// ════════════════════════════════════
async function refreshService(service) {
  const statusEl = $(`#${service}Status`);
  const listEl = $(`#${service}List`);

  // Show scanning state
  statusEl.className = 'service-status service-status--scanning';
  statusEl.innerHTML = '<span class="status-dot"></span> Scanning for open tab...';

  listEl.innerHTML = `
    <div class="loading">
      <span class="loading__dot"></span>
      <span class="loading__dot"></span>
      <span class="loading__dot"></span>
    </div>`;

  try {
    const response = await sendMessageWithTimeout(
      { type: 'SCRAPE_SERVICE', service },
      25000
    );

    if (response && response.success) {
      cache[service] = response.data;
      statusEl.className = 'service-status service-status--connected';
      statusEl.innerHTML = `<span class="status-dot"></span> Live`;

      const tabBtn = $(`.tabs__btn[data-tab="${service}"]`);
      if (tabBtn && response.data && response.data.length > 0) {
        tabBtn.classList.add('tabs__btn--has-data');
      }

      renderServiceData(service, response.data);
    } else {
      statusEl.className = 'service-status service-status--error';
      statusEl.innerHTML = `<span class="status-dot"></span> ${response?.error || 'No matching tab found'}`;
      renderEmptyService(service);
    }
  } catch (err) {
    statusEl.className = 'service-status service-status--error';
    statusEl.innerHTML = `<span class="status-dot"></span> Error: ${err.message}`;
    renderEmptyService(service);
  }
}

function setServiceCount(service, n) {
  const el = $(`#${service}Count`);
  if (!el) return;
  if (n > 0) {
    el.textContent = n;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function renderServiceData(service, data) {
  const listEl = $(`#${service}List`);

  if (!data || data.length === 0) {
    setServiceCount(service, 0);
    renderEmptyService(service, true);
    return;
  }

  setServiceCount(service, data.length);
  if (service === 'github') renderGitHub(listEl, data);
  else if (service === 'slack') renderSlack(listEl, data);
  else if (service === 'calendar') renderCalendar(listEl, data);
}

// ────── GitHub Renderer ──────
function renderGitHub(el, prs) {
  // Group by section: review requested, your PRs, etc.
  const reviewRequested = prs.filter(p => p.section === 'review-requested');
  const yourPRs = prs.filter(p => p.section === 'created');
  const assigned = prs.filter(p => p.section === 'assigned');
  const other = prs.filter(p => !['review-requested', 'created', 'assigned'].includes(p.section));

  const groups = [
    { key: 'review-requested', label: 'Review Requested', items: reviewRequested },
    { key: 'created',          label: 'Your PRs',         items: yourPRs },
    { key: 'assigned',         label: 'Assigned',         items: assigned },
    { key: 'other',            label: 'Other',            items: other },
  ].filter(g => g.items.length);

  let html = '';
  if (groups.length) {
    groups.forEach(g => {
      const collapsed = localStorage.getItem(`prGroup_${g.key}`) === 'collapsed';
      html += `
        <div class="pr-group ${collapsed ? 'pr-group--collapsed' : ''}" data-group="${g.key}">
          <button type="button" class="pr-group__header">
            <svg class="pr-group__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polyline points="6 9 12 15 18 9"/></svg>
            <span class="pr-group__label">${g.label}</span>
            <span class="pr-group__count">${g.items.length}</span>
          </button>
          <div class="pr-group__content">
            ${g.items.map(pr => prCard(pr)).join('')}
          </div>
        </div>`;
    });
  } else {
    html = prs.map(pr => prCard(pr)).join('');
  }

  el.innerHTML = html;

  // Collapsible group toggle
  el.querySelectorAll('.pr-group__header').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.pr-group');
      const key = group.dataset.group;
      const isNowCollapsed = group.classList.toggle('pr-group--collapsed');
      localStorage.setItem(`prGroup_${key}`, isNowCollapsed ? 'collapsed' : 'open');
    });
  });

  // Click to open PR
  el.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });
}

function prCard(pr) {
  const badgeClass = pr.draft ? 'badge--draft' :
    pr.state === 'merged' ? 'badge--merged' :
    pr.state === 'closed' ? 'badge--closed' :
    pr.reviewStatus === 'review' ? 'badge--review' : 'badge--open';
  const badgeText = pr.draft ? 'Draft' :
    pr.state === 'merged' ? 'Merged' :
    pr.state === 'closed' ? 'Closed' :
    pr.reviewStatus === 'review' ? 'In Review' : 'Open';

  return `
    <div class="item-card" data-url="${escapeHtml(pr.url || '')}">
      <div class="item-card__title">${escapeHtml(pr.title)}</div>
      <div class="item-card__meta">
        <span class="item-card__badge ${badgeClass}">${badgeText}</span>
        <span>${escapeHtml(pr.repo || '')}</span>
        ${pr.time ? `<span>${timeAgo(pr.time)}</span>` : ''}
        ${pr.comments ? `<span>💬 ${pr.comments}</span>` : ''}
      </div>
    </div>`;
}

// ────── Slack Renderer ──────
function renderSlack(el, messages) {
  // Sort by most recent first — use sortTs (unix ms) if available, otherwise reverse DOM order
  messages.sort((a, b) => {
    if (a.sortTs && b.sortTs) return b.sortTs - a.sortTs;
    if (a.sortTs) return -1;
    if (b.sortTs) return 1;
    return 0; // preserve original order if no timestamps
  });

  el.innerHTML = messages.map(msg => `
    <div class="message-card" data-url="${escapeHtml(msg.url || '')}">
      <div class="message-card__header">
        ${msg.avatar ? `<img class="message-card__avatar" src="${msg.avatar}" alt="">` : '<div class="message-card__avatar"></div>'}
        <span class="message-card__sender">${escapeHtml(msg.sender || 'Unknown')}</span>
        <span class="message-card__time">${escapeHtml(msg.time || '')}</span>
      </div>
      <div class="message-card__text">${escapeHtml(msg.text || '')}</div>
      ${msg.channel ? `<div class="message-card__channel">#${escapeHtml(msg.channel)}</div>` : ''}
    </div>
  `).join('');

  el.querySelectorAll('.message-card').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });
}

// ────── Calendar Renderer ──────
function renderCalendar(el, events) {
  const now = new Date();

  el.innerHTML = events.map(evt => {
    let timeClass = '';
    if (evt.startTime && evt.endTime) {
      const start = new Date(evt.startTime);
      const end = new Date(evt.endTime);
      if (now >= start && now <= end) timeClass = 'event-card--now';
      else if (now > end) timeClass = 'event-card--past';
    }

    return `
      <div class="event-card ${timeClass}" data-url="${escapeHtml(evt.url || '')}">
        <div class="event-card__time">${escapeHtml(evt.timeDisplay || evt.time || '')}</div>
        <div class="event-card__title">${escapeHtml(evt.title)}</div>
        ${evt.location ? `<div class="event-card__location">📍 ${escapeHtml(evt.location)}</div>` : ''}
      </div>`;
  }).join('');

  el.querySelectorAll('.event-card').forEach(card => {
    card.addEventListener('click', () => {
      const url = card.dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });
}

// ────── Empty States ──────
function renderEmptyService(service, connected = false) {
  const listEl = $(`#${service}List`);
  const messages = {
    github: {
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" opacity="0.4"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`,
      text: connected ? 'No PRs found' : 'No GitHub tab detected',
      sub: connected ? 'All clear!' : 'Open <a href="https://github.com/pulls" target="_blank">github.com/pulls</a> to see your PRs'
    },
    slack: {
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" opacity="0.4"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z"/></svg>`,
      text: connected ? 'No recent mentions' : 'No Slack tab detected',
      sub: connected ? 'Inbox zero!' : 'Open <a href="https://app.slack.com" target="_blank">app.slack.com</a> to see mentions'
    },
    calendar: {
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" opacity="0.4"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      text: connected ? 'No events today' : 'No Calendar tab detected',
      sub: connected ? 'Free day!' : 'Open <a href="https://calendar.google.com" target="_blank">Google Calendar</a> to see events'
    }
  };

  const msg = messages[service];
  listEl.innerHTML = `
    <div class="empty-state">
      ${msg.icon}
      <p>${msg.text}</p>
      <p class="empty-state__sub">${msg.sub}</p>
    </div>`;
}

// ────── Little Arc (small popup window) ──────
function openInLittleArc(url) {
  if (!url) return;
  try {
    chrome.windows.create({ type: 'popup', width: 420, height: 700, url });
  } catch (_) {}
}

// ────── Utilities ──────
function getDomainInitial(url) {
  try { return new URL(url).hostname.replace('www.','')[0].toUpperCase(); } catch { return '?'; }
}
function getDomain(url) {
  try { return new URL(url).hostname.replace('www.',''); } catch { return ''; }
}
function renderSkeletonCards(count = 3) {
  return Array.from({length: count}, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton--icon"></div>
      <div class="skeleton-card__body">
        <div class="skeleton skeleton--title"></div>
        <div class="skeleton skeleton--meta"></div>
      </div>
    </div>`).join('');
}

function sendMessageWithTimeout(message, timeoutMs) {
  return Promise.race([
    chrome.runtime.sendMessage(message),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Try again or check the service tab.')), timeoutMs)
    )
  ]);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function timeAgo(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return str;
  const sec = Math.floor((Date.now() - d) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec/86400)}d ago`;
  return d.toLocaleDateString('en',{month:'short',day:'numeric'});
}

function isNewTabUrl(url) {
  if (!url) return true;
  const u = (url || '').toLowerCase();
  return u === 'chrome://newtab/' || u === 'about:blank' || u.startsWith('edge://newtab') || u === 'chrome-search://local-ntp/';
}

/** If current window is empty (no tabs or only new-tab page), restore last active workspace. Returns true if restored. */
async function tryRestoreLastActiveWorkspace() {
  try {
    const win = await chrome.windows.getLastFocused();
    if (!win || win.id == null) return false;
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const isEmpty = tabs.length === 0 || (tabs.length === 1 && isNewTabUrl(tabs[0].url));
    if (!isEmpty) return false;
    const { lastActiveWorkspaceId, workspaces = [] } = await chrome.storage.local.get(['lastActiveWorkspaceId', 'workspaces']);
    if (!lastActiveWorkspaceId) return false;
    const raw = workspaces.find(w => w.id === lastActiveWorkspaceId);
    if (!raw) return false;
    const ws = normalizeWorkspace(raw);
    const tabCount = (ws.pinnedTabs || []).length + (ws.tabs || []).length;
    if (tabCount === 0) return false;
    await restoreSavedSpace(ws, false);
    return true;
  } catch (_) {
    return false;
  }
}

/** When current space is a saved workspace, remember it as last active. */
async function updateLastActiveIfCurrentIsSaved() {
  if (!currentSpaceId) return;
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  if (workspaces.some(w => w.id === currentSpaceId)) {
    await chrome.storage.local.set({ lastActiveWorkspaceId: currentSpaceId });
  }
}

// ────── Settings ──────
async function loadSettings() {
  const { slackWorkspaceId = '' } = await chrome.storage.local.get('slackWorkspaceId');
  const input = $('#slackWorkspaceId');
  if (input) input.value = slackWorkspaceId;
}

$('#saveSlackWorkspaceId').addEventListener('click', async () => {
  const input = $('#slackWorkspaceId');
  const workspaceId = (input && input.value.trim()) || '';
  await chrome.storage.local.set({ slackWorkspaceId: workspaceId });

  // Show feedback
  const btn = $('#saveSlackWorkspaceId');
  const originalText = btn.textContent;
  btn.textContent = 'Saved!';
  setTimeout(() => { btn.textContent = originalText; }, 1500);

  // Refresh Slack to use new workspace ID
  refreshService('slack');
});

// ────── Bulk Operations (Multi-Select) ──────
const bulkSelection = {
  selected: new Set(),
  mode: null, // 'tabs' or 'pinned'

  add(id) {
    this.selected.add(id);
    this.updateUI();
  },

  remove(id) {
    this.selected.delete(id);
    this.updateUI();
  },

  toggle(id) {
    if (this.selected.has(id)) {
      this.remove(id);
    } else {
      this.add(id);
    }
  },

  clear() {
    this.selected.clear();
    this.mode = null;
    this.updateUI();
  },

  updateUI() {
    const bulkBar = document.getElementById('bulkActionsBar');
    if (this.selected.size === 0) {
      if (bulkBar) bulkBar.hidden = true;
      // Uncheck all checkboxes
      document.querySelectorAll('.tab-checkbox:checked').forEach(cb => cb.checked = false);
    } else {
      if (bulkBar) {
        bulkBar.hidden = false;
        const count = document.getElementById('bulkSelectionCount');
        if (count) count.textContent = this.selected.size;
      }
    }
  }
};

// ────── Undo/Redo System ──────
class UndoManager {
  constructor(maxSize = 20) {
    this.stack = [];
    this.maxSize = maxSize;
  }

  push(operation) {
    this.stack.push({
      type: operation.type,
      data: operation.data,
      timestamp: Date.now(),
      undo: operation.undo
    });

    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
  }

  async undo() {
    if (this.stack.length === 0) {
      showTempNotification('Nothing to undo');
      return;
    }

    const operation = this.stack.pop();
    try {
      await operation.undo();
      showTempNotification(`Undone: ${operation.type}`);
    } catch (e) {
      console.error('Undo failed:', e);
      showTempNotification('Undo failed: ' + e.message);
    }
  }

  canUndo() {
    return this.stack.length > 0;
  }

  clear() {
    this.stack = [];
  }
}

const undoManager = new UndoManager();

// Keyboard shortcut for undo (Cmd+Z or Ctrl+Z)
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoManager.undo();
  }
});

// ────── Auto-Archive ──────
async function checkAutoArchive() {
  if (!currentSpaceId || !currentWindowId) return;

  try {
    const { spaces = {} } = await chrome.storage.local.get('spaces');
    const space = spaces[currentSpaceId];

    // Check if auto-archive is enabled for this space
    if (!space || !space.autoArchiveHours || space.autoArchiveHours <= 0) return;

    const tabs = await chrome.tabs.query({ windowId: currentWindowId });
    const now = Date.now();
    const cutoffMs = space.autoArchiveHours * 60 * 60 * 1000;
    const cutoff = now - cutoffMs;

    // Find tabs that haven't been accessed recently
    const toArchive = tabs.filter(t => {
      if (!t.url || t.url.startsWith('chrome://') || t.url.startsWith('edge://')) return false;
      // Pinned tabs and tabs in pinnedEntries are excluded
      const isPinned = t.pinned || (space.pinnedEntries || []).some(e => e.url === t.url);
      if (isPinned) return false;
      // Check last accessed time
      return t.lastAccessed && t.lastAccessed < cutoff;
    });

    if (toArchive.length === 0) return;

    // Ensure "Archived" folder exists
    if (!space.pinnedFolders) space.pinnedFolders = [];
    let archivedFolder = space.pinnedFolders.find(f => f.name === 'Archived');

    if (!archivedFolder) {
      archivedFolder = {
        name: 'Archived',
        entryUrls: [],
        collapsed: true
      };
      space.pinnedFolders.push(archivedFolder);
    }

    if (!space.pinnedEntries) space.pinnedEntries = [];

    // Archive each tab
    const archivedCount = toArchive.length;
    for (const tab of toArchive) {
      // Add to pinned entries if not already there
      if (!space.pinnedEntries.some(e => e.url === tab.url)) {
        space.pinnedEntries.push({
          url: tab.url,
          title: tab.title || tab.url,
          favIconUrl: tab.favIconUrl || ''
        });
      }

      // Add to archived folder
      if (!archivedFolder.entryUrls.includes(tab.url)) {
        archivedFolder.entryUrls.push(tab.url);
      }

      // Close the tab
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        console.error('Failed to close archived tab:', e);
      }
    }

    // Save changes
    await chrome.storage.local.set({ spaces });
    loadCurrentSpace();

    // Show notification
    showTempNotification(`Archived ${archivedCount} old tab${archivedCount !== 1 ? 's' : ''} (inactive for ${space.autoArchiveHours}h)`, 4000);

    console.log(`[HOME] Auto-archived ${archivedCount} tabs to "${archivedFolder.name}" folder`);
  } catch (e) {
    console.error('[HOME] Auto-archive failed:', e);
  }
}

// Run auto-archive check every hour
setInterval(checkAutoArchive, 60 * 60 * 1000);

// Also run on load (after 30s to let things settle)
setTimeout(checkAutoArchive, 30 * 1000);

// ────── Init ──────
(async () => {
  // Inject loading skeletons immediately so lists don't look empty during fetch
  ['githubList','slackList','calendarList'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = renderSkeletonCards();
  });

  // Wire up section menu buttons
  document.getElementById('tabsSectionMenuBtn')?.addEventListener('click', showTabsSectionMenu);
  document.getElementById('pinnedSectionMenuBtn')?.addEventListener('click', showPinnedSectionMenu);

  const restored = await tryRestoreLastActiveWorkspace();
  if (!restored) {
    await loadCurrentSpace();
    loadSavedSpaces();
    await updateLastActiveIfCurrentIsSaved();
  }
  await loadSettings();
})();

// Auto-refresh all services when side panel opens (fixes "only loading" when no data ever requested)
refreshService('github');
refreshService('slack');
refreshService('calendar');

// Debounce auto-save to avoid hammering storage on rapid tab changes
let persistDebounceTimer = null;
function schedulePersistCurrentSpace() {
  if (persistDebounceTimer) clearTimeout(persistDebounceTimer);
  persistDebounceTimer = setTimeout(async () => {
    persistDebounceTimer = null;
    await persistCurrentSpaceSnapshot();
  }, 250);
}

// ────── Recently Closed ──────
const MAX_RECENT = 10;

async function addRecentlyClosed(tab) {
  if (!currentSpaceId || !tab || !tab.url) return;
  const { spaces = {} } = await chrome.storage.local.get('spaces');
  const space = spaces[currentSpaceId];
  if (!space) return;
  // Don't track if it's a pinned entry
  if ((space.pinnedEntries || []).some(e => e.url === tab.url)) return;
  if (!space.recentlyClosed) space.recentlyClosed = [];
  // Remove duplicate if already present
  space.recentlyClosed = space.recentlyClosed.filter(t => t.url !== tab.url);
  // Prepend and cap
  space.recentlyClosed.unshift({ url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '', closedAt: Date.now() });
  space.recentlyClosed = space.recentlyClosed.slice(0, MAX_RECENT);
  spaces[currentSpaceId] = space;
  await chrome.storage.local.set({ spaces });
  renderRecentlyClosed(space.recentlyClosed);
}

function renderRecentlyClosed(items) {
  const section = $('#recentlyClosedSection');
  const list = $('#recentlyClosedList');
  const countEl = $('#recentlyClosedCount');
  if (!section || !list) return;

  if (!items || items.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  if (countEl) countEl.textContent = items.length;

  list.innerHTML = items.map(t => `
    <div class="recently-closed__item" data-url="${escapeHtml(t.url)}">
      ${t.favIconUrl ? `<img src="${escapeHtml(t.favIconUrl)}" alt="">` : '<span style="width:14px;height:14px;flex-shrink:0"></span>'}
      <span class="recently-closed__item-title" title="${escapeHtml(t.url)}">${escapeHtml(truncate(t.title || t.url, 38))}</span>
      <button type="button" class="recently-closed__restore" data-url="${escapeHtml(t.url)}" title="Reopen">↩</button>
    </div>
  `).join('');

  list.querySelectorAll('.recently-closed__item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;
      const url = el.dataset.url;
      if (url && currentWindowId) await chrome.tabs.create({ url, windowId: currentWindowId }).catch(() => {});
    });
  });
  list.querySelectorAll('.recently-closed__restore').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = btn.dataset.url;
      if (url && currentWindowId) await chrome.tabs.create({ url, windowId: currentWindowId }).catch(() => {});
    });
  });
}

$('#recentlyClosedToggle').addEventListener('click', () => {
  $('#recentlyClosedSection').classList.toggle('collapsed');
});

$('#clearRecentlyClosed').addEventListener('click', async () => {
  if (!currentSpaceId) return;
  const { spaces = {} } = await chrome.storage.local.get('spaces');
  if (spaces[currentSpaceId]) {
    spaces[currentSpaceId].recentlyClosed = [];
    await chrome.storage.local.set({ spaces });
    renderRecentlyClosed([]);
  }
});

// ════════════════════════════════════
//  IMAGE PICKER
// ════════════════════════════════════

// ── Module state ──
let _imageDirHandle = null;        // FileSystemDirectoryHandle | null
const _imageBlobUrls = new Set();  // blob: URLs we created (to revoke on reload)
let _imageFileNames  = [];         // snapshot of last-rendered file names (for change detection)
let _imagePollTimer  = null;       // setInterval handle

// ── IndexedDB helpers ──
const IDB_NAME    = 'home-image-picker';
const IDB_VERSION = 1;
const IDB_STORE   = 'handles';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function idbSaveHandle(handle) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ id: 'dirHandle', handle });
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

async function idbLoadHandle() {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get('dirHandle');
      req.onsuccess = (e) => resolve(e.target.result ? e.target.result.handle : null);
      req.onerror   = (e) => reject(e.target.error);
    });
  } catch {
    return null;
  }
}

async function idbClearHandle() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete('dirHandle');
    tx.oncomplete = () => resolve();
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// ── Permission helpers ──
async function imagesQueryPermission(handle) {
  try {
    const perm = await handle.queryPermission({ mode: 'read' });
    return perm === 'granted';
  } catch { return false; }
}

async function imagesRequestPermission(handle) {
  try {
    const perm = await handle.requestPermission({ mode: 'read' });
    return perm === 'granted';
  } catch { return false; }
}

// ── Read files from directory ──
const IMAGE_EXTS = new Set([
  'jpg','jpeg','png','gif','webp','avif','bmp','tiff','tif',
  'svg','ico','heic','heif'
]);

async function imagesReadFiles(handle) {
  const files = [];
  for await (const [, entry] of handle.entries()) {
    if (entry.kind !== 'file') continue;
    const ext = entry.name.split('.').pop().toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    try {
      const file = await entry.getFile();
      files.push(file);
    } catch { /* skip unreadable */ }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Blob URL management ──
function imagesRevokeBlobUrls() {
  _imageBlobUrls.forEach(u => URL.revokeObjectURL(u));
  _imageBlobUrls.clear();
}

function imagesCreateBlobUrl(file) {
  const url = URL.createObjectURL(file);
  _imageBlobUrls.add(url);
  return url;
}

// ── Re-encode raster to PNG via OffscreenCanvas ──
async function imagesReencodeToPng(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}

// ── Copy file to clipboard ──
async function imagesCopyToClipboard(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    let blob;
    if (ext === 'heic' || ext === 'heif') {
      // HEIC not decodable by browser — cannot copy
      throw new Error('unsupported');
    } else {
      // SVGs and all raster formats re-encoded to PNG via OffscreenCanvas
      // (navigator.clipboard.write only accepts image/png reliably in Chrome)
      blob = await imagesReencodeToPng(file);
    }
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
    return true;
  } catch {
    return false;
  }
}

// ── Toast ──
function imagesShowToast(msg) {
  const existing = document.querySelector('.images-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'images-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  el.addEventListener('animationend', (e) => {
    if (e.animationName === 'toast-out') el.remove();
  });
}

// ── Render ──
function renderImages(files) {
  const list       = $('#imagesList');
  const countEl    = $('#imagesCount');
  const statusEl   = $('#imagesStatus');

  statusEl.className = 'service-status';
  statusEl.innerHTML = '';

  if (!_imageDirHandle) {
    // no-folder state
    countEl.hidden = true;
    list.innerHTML = `
      <div class="empty-state empty-state--compact">
        <p>Pick a local folder to browse images</p>
        <button type="button" class="btn btn--primary btn--sm" id="imagesPickBtn" style="margin-top:10px">
          Choose Folder
        </button>
      </div>`;
    document.getElementById('imagesPickBtn').addEventListener('click', imagesPickFolder);
    return;
  }

  if (files === 'permission-prompt') {
    // need user gesture to re-grant
    countEl.hidden = true;
    const folderName = _imageDirHandle.name;
    list.innerHTML = `
      <div class="empty-state empty-state--compact">
        <p>Allow access to <strong>${escapeHtml(folderName)}</strong> to continue</p>
        <button type="button" class="btn btn--primary btn--sm" id="imagesGrantBtn" style="margin-top:10px">
          Grant Access
        </button>
      </div>`;
    document.getElementById('imagesGrantBtn').addEventListener('click', imagesGrantAccess);
    renderImagesToolbar();
    return;
  }

  if (files === 'error') {
    countEl.hidden = true;
    list.innerHTML = `
      <div class="empty-state empty-state--compact">
        <p style="color:var(--red)">Could not read folder. Try picking again.</p>
      </div>`;
    renderImagesToolbar();
    return;
  }

  if (files.length === 0) {
    countEl.hidden = true;
    list.innerHTML = `
      <div class="empty-state empty-state--compact">
        <p>No images found in this folder.</p>
      </div>`;
    renderImagesToolbar();
    return;
  }

  // loaded — show grid
  countEl.hidden = false;
  countEl.textContent = files.length;
  _imageFileNames = files.map(f => f.name); // update snapshot for poll change-detection

  // Clear old DOM first (removes live <img> references), then revoke old blob URLs
  list.innerHTML = '';
  imagesRevokeBlobUrls();

  const grid = document.createElement('div');
  grid.className = 'images-grid';

  files.forEach(file => {
    // Create blob URLs only AFTER old ones are revoked
    const blobUrl = imagesCreateBlobUrl(file);
    const thumb = document.createElement('div');
    thumb.className = 'images-thumb';
    thumb.title = file.name;
    thumb.innerHTML = `
      <img src="${blobUrl}" alt="${escapeHtml(file.name)}">
      <span class="images-thumb__name">${escapeHtml(file.name)}</span>`;
    thumb.addEventListener('click', async () => {
      const ok = await imagesCopyToClipboard(file);
      if (ok) {
        imagesShowToast('Copied to clipboard');
        thumb.classList.add('images-thumb--copied');
        setTimeout(() => thumb.classList.remove('images-thumb--copied'), 1000);
      } else {
        imagesShowToast('Could not copy — format not supported');
      }
    });
    grid.appendChild(thumb);
  });

  renderImagesToolbar();
  list.appendChild(grid);
}

function renderImagesToolbar() {
  const list = $('#imagesList');
  // Remove existing toolbar to avoid duplicates on re-render
  const existing = list.querySelector('.images-toolbar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.className = 'images-toolbar';
  bar.innerHTML = `
    <span class="images-folder-name" title="${escapeHtml(_imageDirHandle ? _imageDirHandle.name : '')}">
      📁 ${escapeHtml(_imageDirHandle ? _imageDirHandle.name : '')}
    </span>
    <button type="button" class="btn btn--ghost btn--sm" id="imagesChangeBtn">Change</button>
    <button type="button" class="btn btn--ghost btn--sm btn--danger" id="imagesRemoveBtn" title="Remove folder">✕</button>`;
  bar.querySelector('#imagesChangeBtn').addEventListener('click', imagesPickFolder);
  bar.querySelector('#imagesRemoveBtn').addEventListener('click', async () => {
    imagesStopPolling();
    imagesRevokeBlobUrls();
    _imageDirHandle = null;
    _imageFileNames = [];
    await idbClearHandle();
    renderImages(null);
  });
  list.insertBefore(bar, list.firstChild);
}

// ── Pick folder (requires user gesture) ──
async function imagesPickFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    _imageDirHandle = handle;
    await idbSaveHandle(handle);
    await imagesLoadAndRender();
  } catch (e) {
    if (e.name !== 'AbortError') {
      imagesShowToast('Could not open folder');
    }
  }
}

// ── Grant access after permission prompt (requires user gesture) ──
async function imagesGrantAccess() {
  if (!_imageDirHandle) return;
  const granted = await imagesRequestPermission(_imageDirHandle);
  if (granted) {
    await imagesLoadAndRender();
  } else {
    imagesShowToast('Permission denied');
  }
}

// ── Polling ──
const IMAGES_POLL_INTERVAL = 5000; // ms

function imagesStartPolling() {
  if (_imagePollTimer) return; // already running
  _imagePollTimer = setInterval(imagesPoll, IMAGES_POLL_INTERVAL);
}

function imagesStopPolling() {
  if (_imagePollTimer) {
    clearInterval(_imagePollTimer);
    _imagePollTimer = null;
  }
}

async function imagesPoll() {
  if (!_imageDirHandle) { imagesStopPolling(); return; }

  // Skip if no permission (don't prompt — just wait)
  const hasPermission = await imagesQueryPermission(_imageDirHandle);
  if (!hasPermission) return;

  let files;
  try {
    files = await imagesReadFiles(_imageDirHandle);
  } catch {
    return; // silently skip on read error
  }

  // Compare file names to detect additions / deletions
  const newNames = files.map(f => f.name);
  const changed  = newNames.length !== _imageFileNames.length ||
                   newNames.some((n, i) => n !== _imageFileNames[i]);
  if (changed) {
    renderImages(files);
  }
}

// ── Load files and render ──
async function imagesLoadAndRender() {
  if (!_imageDirHandle) { imagesStopPolling(); renderImages(null); return; }

  // Check permission silently first
  const hasPermission = await imagesQueryPermission(_imageDirHandle);
  if (!hasPermission) {
    imagesStopPolling();
    renderImages('permission-prompt');
    return;
  }

  try {
    const files = await imagesReadFiles(_imageDirHandle);
    renderImages(files);
    imagesStartPolling();
  } catch {
    imagesStopPolling();
    renderImages('error');
  }
}

// ── Init ──
async function initImagePicker() {
  // Try to restore handle from IndexedDB
  const savedHandle = await idbLoadHandle();
  if (savedHandle) {
    _imageDirHandle = savedHandle;
    await imagesLoadAndRender();
  } else {
    renderImages(null);
  }
}

// Kick off image picker initialization
initImagePicker();

// ────── Context Menu Functions ──────
function showTabEntryMenu(e, tabId, url) {
  e.stopPropagation();
  const existing = document.getElementById('tabEntryMenu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'tabEntryMenu';
  menu.className = 'space-pill-menu';
  menu.innerHTML = `
    <button class="space-pill-menu__item" data-action="pin">📌 Pin tab</button>
    <button class="space-pill-menu__item" data-action="new-window">Open in new window</button>
    <div class="space-pill-menu__divider"></div>
    <button class="space-pill-menu__item space-pill-menu__item--danger" data-action="close">Close tab</button>
  `;
  const rect = e.target.getBoundingClientRect();
  menu.style.cssText = `position:fixed;left:${Math.min(rect.left, window.innerWidth-180)}px;top:${rect.bottom+2}px;z-index:1000`;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  document.addEventListener('click', close, { once: true });
  menu.querySelector('[data-action="pin"]').addEventListener('click', e => { e.stopPropagation(); close(); pinTab(parseInt(tabId,10)); });
  menu.querySelector('[data-action="new-window"]').addEventListener('click', e => { e.stopPropagation(); close(); chrome.tabs.create({ url }); });
  menu.querySelector('[data-action="close"]').addEventListener('click', e => { e.stopPropagation(); close(); closeTab(parseInt(tabId,10)); });
}

function showPinnedEntryMenu(e, index, url) {
  e.stopPropagation();
  const existing = document.getElementById('pinnedEntryMenu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'pinnedEntryMenu';
  menu.className = 'space-pill-menu';
  menu.innerHTML = `
    <button class="space-pill-menu__item" data-action="open">Open tab</button>
    <div class="space-pill-menu__divider"></div>
    <button class="space-pill-menu__item space-pill-menu__item--danger" data-action="unpin">Unpin</button>
  `;
  const rect = e.target.getBoundingClientRect();
  menu.style.cssText = `position:fixed;left:${Math.min(rect.left, window.innerWidth-180)}px;top:${rect.bottom+2}px;z-index:1000`;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  document.addEventListener('click', close, { once: true });
  menu.querySelector('[data-action="open"]').addEventListener('click', e => { e.stopPropagation(); close(); chrome.tabs.create({ url }); });
  menu.querySelector('[data-action="unpin"]').addEventListener('click', e => { e.stopPropagation(); close(); unpinEntry(parseInt(index,10)); });
}

function showTabsSectionMenu(e) {
  e.stopPropagation();
  const existing = document.getElementById('tabsSectionMenu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'tabsSectionMenu';
  menu.className = 'space-pill-menu';
  menu.innerHTML = `
    <button class="space-pill-menu__item" data-action="new-tab">New Tab</button>
    <button class="space-pill-menu__item" data-action="new-folder">New Folder</button>
    <div class="space-pill-menu__divider"></div>
    <button class="space-pill-menu__item" data-action="select-all">Select All</button>
  `;
  const rect = e.target.getBoundingClientRect();
  menu.style.cssText = `position:fixed;left:${Math.min(rect.left, window.innerWidth-180)}px;top:${rect.bottom+2}px;z-index:1000`;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  document.addEventListener('click', close, { once: true });
  menu.querySelector('[data-action="new-tab"]').addEventListener('click', e => { e.stopPropagation(); close(); chrome.tabs.create({}); });
  menu.querySelector('[data-action="new-folder"]').addEventListener('click', e => { e.stopPropagation(); close(); addFolderToActiveSpace && addFolderToActiveSpace(); });
  menu.querySelector('[data-action="select-all"]').addEventListener('click', e => { e.stopPropagation(); close(); document.querySelectorAll('.tab-checkbox').forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change')); }); });
}

function showPinnedSectionMenu(e) {
  e.stopPropagation();
  const existing = document.getElementById('pinnedSectionMenu');
  if (existing) existing.remove();
  const menu = document.createElement('div');
  menu.id = 'pinnedSectionMenu';
  menu.className = 'space-pill-menu';
  menu.innerHTML = `
    <button class="space-pill-menu__item" data-action="new-folder">New Folder</button>
  `;
  const rect = e.target.getBoundingClientRect();
  menu.style.cssText = `position:fixed;left:${Math.min(rect.left, window.innerWidth-180)}px;top:${rect.bottom+2}px;z-index:1000`;
  document.body.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener('click', close); };
  document.addEventListener('click', close, { once: true });
  menu.querySelector('[data-action="new-folder"]').addEventListener('click', e => { e.stopPropagation(); close(); addFolderToActiveSpace && addFolderToActiveSpace(); });
}

// ────── Tab Search ──────
function setupTabSearch() {
  const toggleBtn = document.getElementById('tabSearchToggleBtn');
  if (!toggleBtn) return;

  const container = document.querySelector('.space-section--tabs .space-section__label-row');
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'tabSearchInput';
  input.placeholder = 'Search tabs...';
  input.className = 'tab-search-input';
  input.hidden = true;

  container.parentNode.insertBefore(input, container.nextSibling);

  toggleBtn.addEventListener('click', () => {
    const isOpen = !input.hidden;
    input.hidden = isOpen;
    if (!isOpen) { input.focus(); }
    else { input.value = ''; filterTabs(''); }
  });

  input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.hidden = true; input.value = ''; filterTabs(''); } });
  input.addEventListener('input', e => filterTabs(e.target.value.toLowerCase()));
}

function filterTabs(query) {
  document.querySelectorAll('.space-entry--tab').forEach(row => {
    if (!query) { row.hidden = false; return; }
    const title = (row.querySelector('.space-entry__title')?.textContent || '').toLowerCase();
    const url = (row.dataset.url || '').toLowerCase();
    row.hidden = !(title.includes(query) || url.includes(query));
  });
}

// Set up tab search on load
setupTabSearch();

// ────── Bulk Actions Bar ──────
function setupBulkActionsBar() {
  const existing = document.getElementById('bulkActionsBar');
  if (existing) return; // Already set up

  const liveTabsSection = document.querySelector('.space-section--tabs');
  if (!liveTabsSection) return;

  const bulkBar = document.createElement('div');
  bulkBar.id = 'bulkActionsBar';
  bulkBar.className = 'bulk-actions-bar';
  bulkBar.hidden = true;
  bulkBar.innerHTML = `
    <span class="bulk-count"><strong id="bulkSelectionCount">0</strong> selected</span>
    <button type="button" class="btn btn--sm" id="bulkPinBtn">Pin</button>
    <button type="button" class="btn btn--sm" id="bulkCloseBtn">Close</button>
    <button type="button" class="btn btn--ghost btn--sm" id="bulkCancelBtn">Cancel</button>
  `;

  // Insert before tabs list
  const searchInput = document.getElementById('tabSearchInput');
  if (searchInput && searchInput.nextSibling) {
    searchInput.parentNode.insertBefore(bulkBar, searchInput.nextSibling);
  }

  // Event handlers
  document.getElementById('bulkPinBtn').addEventListener('click', async () => {
    const tabIds = Array.from(bulkSelection.selected);
    for (const id of tabIds) {
      await pinTab(parseInt(id, 10), { skipRerender: true });
    }
    bulkSelection.clear();
    loadCurrentSpace();
    showTempNotification(`Pinned ${tabIds.length} tab${tabIds.length !== 1 ? 's' : ''}`);
  });

  document.getElementById('bulkCloseBtn').addEventListener('click', async () => {
    const tabIds = Array.from(bulkSelection.selected);
    for (const id of tabIds) {
      await closeTab(parseInt(id, 10));
    }
    bulkSelection.clear();
    showTempNotification(`Closed ${tabIds.length} tab${tabIds.length !== 1 ? 's' : ''}`);
  });

  document.getElementById('bulkCancelBtn').addEventListener('click', () => {
    bulkSelection.clear();
  });

  // Checkbox change handler
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('tab-checkbox')) {
      const tabId = e.target.dataset.tabId;
      if (e.target.checked) {
        bulkSelection.add(tabId);
      } else {
        bulkSelection.remove(tabId);
      }
    }
  });
}

// Set up bulk actions bar on load
setupBulkActionsBar();

// Set up event delegation on load (prevents memory leaks)
setupEventDelegation();

// Listen for background messages (e.g., auto-updates, TABS_CHANGED)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SERVICE_UPDATE' && msg.service) {
    cache[msg.service] = msg.data;
    renderServiceData(msg.service, msg.data);
    const tabBtn = $(`.tabs__btn[data-tab="${msg.service}"]`);
    if (tabBtn && msg.data && msg.data.length > 0) {
      tabBtn.classList.add('tabs__btn--has-data');
    }
  }
  if (msg.type === 'TABS_CHANGED' && msg.windowId != null && msg.windowId === currentWindowId) {
    loadCurrentSpace().then(() => schedulePersistCurrentSpace());
  }
  if (msg.type === 'TAB_CLOSED' && msg.windowId === currentWindowId) {
    addRecentlyClosed(msg.tab);
  }
});
