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

    pinnedHtml += `
      <div class="space-entry space-entry--pinned" draggable="true" data-url="${escapeHtml(entry.url)}" data-index="${i}" data-type="pinned-entry">
        <span class="space-entry__drag-handle">⋮⋮</span>
        ${entry.favIconUrl ? `<img class="space-entry__icon" src="${entry.favIconUrl}" alt="">` : '<span class="space-entry__icon"></span>'}
        <span class="space-entry__title">${escapeHtml(truncate(entry.title || entry.url, 40))}</span>
        ${openTab ? '<span class="space-entry__dot" title="Open"></span>' : ''}
        <button type="button" class="btn btn--ghost btn--sm space-entry-unpin" data-index="${i}" title="Unpin">×</button>
      </div>`;
  });
  pinnedEntriesList.innerHTML = pinnedHtml || '<div class="space-empty">No pinned entries</div>';

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
          ${folderEntries.length > 0 ? folderEntries.map((entry) => {
            const openTab = allTabs.find(t => t.url === entry.url);
            return `
            <div class="space-entry space-entry--pinned" draggable="true" data-url="${escapeHtml(entry.url)}" data-type="pinned-entry">
              <span class="space-entry__drag-handle">⋮⋮</span>
              ${entry.favIconUrl ? `<img class="space-entry__icon" src="${entry.favIconUrl}" alt="">` : '<span class="space-entry__icon"></span>'}
              <span class="space-entry__title">${escapeHtml(truncate(entry.title || entry.url, 35))}</span>
              ${openTab ? '<span class="space-entry__dot"></span>' : ''}
              <button type="button" class="btn btn--ghost btn--sm space-entry-unpin" data-url="${escapeHtml(entry.url)}" title="Unpin">×</button>
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
    liveHtml += `
      <div class="space-entry space-entry--tab" draggable="true" data-tab-id="${tab.id}" data-url="${escapeHtml(tab.url)}" data-type="live-tab">
        <span class="space-entry__drag-handle">⋮⋮</span>
        ${tab.favIconUrl ? `<img class="space-entry__icon" src="${tab.favIconUrl}" alt="">` : '<span class="space-entry__icon"></span>'}
        <span class="space-entry__title">${escapeHtml(truncate(tab.title || tab.url, 40))}</span>
        <button type="button" class="btn btn--ghost btn--sm space-entry-pin" data-tab-id="${tab.id}" title="Pin">📌</button>
        <button type="button" class="btn btn--ghost btn--sm space-entry-close" data-tab-id="${tab.id}" title="Close">×</button>
      </div>`;
  });
  liveTabsList.innerHTML = liveHtml || '<div class="space-empty">No tabs below</div>';

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
          ${groupTabs.map(tab => `
            <div class="space-entry space-entry--tab" draggable="true" data-tab-id="${tab.id}" data-url="${escapeHtml(tab.url)}" data-type="live-tab" data-group-id="${g.id}">
              <span class="space-entry__drag-handle">⋮⋮</span>
              ${tab.favIconUrl ? `<img class="space-entry__icon" src="${tab.favIconUrl}" alt="">` : '<span class="space-entry__icon"></span>'}
              <span class="space-entry__title">${escapeHtml(truncate(tab.title || tab.url, 35))}</span>
              <button type="button" class="btn btn--ghost btn--sm space-entry-pin" data-tab-id="${tab.id}" title="Pin">📌</button>
              <button type="button" class="btn btn--ghost btn--sm space-entry-close" data-tab-id="${tab.id}" title="Close">×</button>
            </div>
          `).join('')}
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

function attachSpaceEventListeners(space, windowId, allTabs) {
  pinnedEntriesList.querySelectorAll('.space-entry--pinned').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;
          const url = el.dataset.url;
          if (!url) return;
          const tab = allTabs.find(t => t.url === url);
          if (tab) {
            try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(windowId, { focused: true }); } catch (_) {}
          } else {
            try { await chrome.tabs.create({ url, windowId }); } catch (_) {}
          }
    });
  });
  pinnedEntriesList.querySelectorAll('.space-entry-unpin').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); await unpinEntry(parseInt(btn.dataset.index, 10)); });
  });
  // Setup drag-and-drop
  setupDragAndDrop();

  pinnedFoldersList.querySelectorAll('.space-folder__header').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      // Don't toggle if clicking delete button
      if (e.target.closest('.space-folder-delete')) return;

      const fi = parseInt(btn.dataset.folderIndex, 10);
      const folder = (space.pinnedFolders || [])[fi];
      if (!folder) return;
      const collapsed = !folder.collapsed;
      const { spaces = {} } = await chrome.storage.local.get('spaces');
      if (spaces[currentSpaceId]) {
        if (!spaces[currentSpaceId].pinnedFolders) spaces[currentSpaceId].pinnedFolders = [];
        spaces[currentSpaceId].pinnedFolders[fi] = { ...folder, collapsed };
        await chrome.storage.local.set({ spaces });
      }
      loadCurrentSpace();
    });
  });
  pinnedFoldersList.querySelectorAll('.space-folder-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fi = parseInt(btn.dataset.folderIndex, 10);
      if (confirm('Delete this folder? (Entries will remain pinned)')) {
        await deletePinnedFolder(fi);
      }
    });
  });
  pinnedFoldersList.querySelectorAll('.space-entry--pinned').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;
          const url = el.dataset.url;
          if (!url) return;
          const tab = allTabs.find(t => t.url === url);
          if (tab) {
            try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(windowId, { focused: true }); } catch (_) {}
          } else {
            try { await chrome.tabs.create({ url, windowId }); } catch (_) {}
          }
    });
  });
  pinnedFoldersList.querySelectorAll('.space-entry-unpin').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); await unpinEntry(btn.dataset.url || parseInt(btn.dataset.index, 10)); });
  });
  pinnedFoldersList.querySelectorAll('.space-entry-move-out').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await moveEntryToFolder(btn.dataset.url, -1); // -1 means move out of folder
    });
  });

  liveTabsList.querySelectorAll('.space-entry--tab').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const tabId = parseInt(el.dataset.tabId, 10);
      if (tabId) chrome.tabs.update(tabId, { active: true }).catch(() => {});
    });
  });
  liveTabsList.querySelectorAll('.space-entry-pin').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); await pinTab(parseInt(btn.dataset.tabId, 10)); });
  });
  liveTabsList.querySelectorAll('.space-entry-close').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); try { await chrome.tabs.remove(parseInt(btn.dataset.tabId, 10)); } catch (_) {} loadCurrentSpace(); });
  });

  liveFoldersList.querySelectorAll('.space-folder__header--live').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      // Don't toggle if clicking delete button
      if (e.target.closest('.space-tabgroup-delete')) return;

      const gid = btn.dataset.groupId;
      if (!gid) return;
      const collapsed = await getGroupCollapsed(gid);
      await setGroupCollapsed(gid, !collapsed);
      loadCurrentSpace();
    });
  });
  liveFoldersList.querySelectorAll('.space-tabgroup-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Ungroup these tabs?')) {
        await deleteTabGroup(btn.dataset.groupId);
      }
    });
  });
  liveFoldersList.querySelectorAll('.space-entry--tab').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const tabId = parseInt(el.dataset.tabId, 10);
      if (tabId) chrome.tabs.update(tabId, { active: true }).catch(() => {});
    });
  });
  liveFoldersList.querySelectorAll('.space-entry-pin').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); await pinTab(parseInt(btn.dataset.tabId, 10)); });
  });
  liveFoldersList.querySelectorAll('.space-entry-close').forEach(btn => {
    btn.addEventListener('click', async (e) => { e.stopPropagation(); try { await chrome.tabs.remove(parseInt(btn.dataset.tabId, 10)); } catch (_) {} loadCurrentSpace(); });
  });
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
      // TODO: If dropping on tab group, add to group
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
  if (space.pinnedEntries.some(e => e.url === tab.url)) return;
  space.pinnedEntries.push({ url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '' });
  await chrome.storage.local.set({ spaces });
  try { await chrome.tabs.update(tabId, { pinned: true }); } catch (_) {}
  if (!skipRerender) {
    loadCurrentSpace();
    schedulePersistCurrentSpace();
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

  const { spaces = {}, workspaces = [] } = await chrome.storage.local.get(['spaces', 'workspaces']);
  const space = spaces[currentSpaceId];
  if (space) {
    space.name = name;
    space.emoji = emoji;
    space.sections = sections;
    space.theme = theme;
  }
  const wsIndex = workspaces.findIndex(w => w.id === currentSpaceId);
  if (wsIndex >= 0) {
    workspaces[wsIndex].name = name;
    workspaces[wsIndex].emoji = emoji;
    workspaces[wsIndex].sections = sections;
    workspaces[wsIndex].theme = theme;
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
  const ids = existing.map(t => t.id).filter(Boolean);
  if (ids.length) await chrome.tabs.remove(ids);

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

  // Update the window-to-space mapping (don't close tabs, just switch the space association)
  const { spaces = {}, windowIdToSpaceId = {} } = await chrome.storage.local.get(['spaces', 'windowIdToSpaceId']);

  // If space doesn't exist in spaces storage, create it from workspace
  if (!spaces[ws.id]) {
    spaces[ws.id] = {
      id: ws.id,
      name: ws.name,
      emoji: ws.emoji || '',
      pinnedEntries: (ws.pinnedTabs || []).slice(),
      pinnedFolders: [],
      autoArchiveHours: 12,
      saved: true,
      createdAt: ws.createdAt || new Date().toISOString()
    };
  }

  // Update window-to-space mapping
  windowIdToSpaceId[win.id] = ws.id;
  await chrome.storage.local.set({ spaces, windowIdToSpaceId, lastActiveWorkspaceId: ws.id });

  // Update current state
  currentSpaceId = ws.id;
  currentWindowId = win.id;

  // Reload UI to show the new space
  loadCurrentSpace();
  loadSavedSpaces();
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
    <span class="open-tabs-banner__text">Open ${tabCount} saved tab${tabCount !== 1 ? 's' : ''} for <strong></strong> in a new window?</span>
    <div class="open-tabs-banner__actions">
      <button class="open-tabs-banner__btn open-tabs-banner__btn--confirm">Open in new window</button>
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

  banner.querySelector('.open-tabs-banner__btn--confirm').addEventListener('click', async () => {
    banner.remove();
    await restoreSavedSpaceFromId(ws.id, true);
  });
  banner.querySelector('.open-tabs-banner__btn--dismiss').addEventListener('click', () => {
    banner.remove();
  });

  // Auto-dismiss after 8s
  setTimeout(() => { if (banner.isConnected) banner.remove(); }, 8000);
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
          showOpenTabsBanner(ws);
        }
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const ws = workspaces.find(w => w.id === btn.dataset.id);
        if (!ws) return;
        showSpacePillMenu(e.clientX, e.clientY, ws);
      });
    });
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
        ${pr.time ? `<span>${escapeHtml(pr.time)}</span>` : ''}
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

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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

// ────── Init ──────
(async () => {
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
