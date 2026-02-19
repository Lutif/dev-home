/* ═══════════════════════════════════════════
   HOME — Background Service Worker
   Handles: tab discovery, message routing,
   content script injection, caching
   ═══════════════════════════════════════════ */

// ────── Service Configuration ──────
const SERVICE_MATCH = {
  github: (url) => url.includes('github.com'),
  slack: (url) => url.includes('app.slack.com') && url.includes('/activity'),
  calendar: (url) => url.includes('calendar.google.com')
};

const SERVICE_URLS = {
  github: 'https://github.com/pulls',
  slack: 'https://app.slack.com/client',
  calendar: 'https://calendar.google.com/calendar/u/0/r'
};

const SCRAPE_MSG_TYPES = {
  github: 'SCRAPE_GITHUB',
  slack: 'SCRAPE_SLACK',
  calendar: 'SCRAPE_CALENDAR'
};

// ────── Cache ──────
const cache = {};
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// ────── Init (runs when service worker starts) ──────
try {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} catch (e) {
  console.warn('sidePanel.setPanelBehavior not available:', e.message);
}

try {
  chrome.alarms.create('refresh-services', { periodInMinutes: 5 });
  chrome.alarms.create('auto-archive-tabs', { periodInMinutes: 60 });
} catch (e) {
  console.warn('alarms.create not available:', e.message);
}

// ────── Command: Open HOME and focus search ──────
try {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'open-home') return;
    const win = await chrome.windows.getLastFocused();
    if (!win || win.id == null) return;
    await chrome.storage.session.set({ focusCommandBar: true });
    try {
      await chrome.sidePanel.open({ windowId: win.id });
    } catch (e) {
      console.warn('sidePanel.open failed:', e.message);
    }
  });
} catch (e) {
  console.warn('commands.onCommand not available:', e.message);
}

// ────── Message Handler (from side panel) ──────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCRAPE_SERVICE') {
    handleScrapeRequest(msg.service)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async response
  }
  return false;
});

// ────── Core Scrape Handler ──────
async function handleScrapeRequest(service) {
  // Check cache first
  const cached = cache[service];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { success: true, data: cached.data };
  }

  // GitHub: Use fetch-based scraping (no tabs needed!)
  if (service === 'github') {
    try {
      const data = await fetchGitHubPRs();
      cache[service] = { data, timestamp: Date.now() };
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: `GitHub fetch failed: ${err.message}. Ensure you're logged into GitHub.`
      };
    }
  }

  // Slack & Calendar: Use tab-based scraping (SPAs need real browser context)
  let tabs = await chrome.tabs.query({});
  let matchingTabs = tabs.filter(t => t.url && SERVICE_MATCH[service]?.(t.url));

  // If no matching tab found, create one in the background
  if (matchingTabs.length === 0) {
    console.log(`[HOME] No ${service} tab found, creating one...`);
    try {
      // For Slack, build URL with workspace ID to /activity page
      let targetUrl = SERVICE_URLS[service];
      if (service === 'slack') {
        const { slackWorkspaceId = '' } = await chrome.storage.local.get('slackWorkspaceId');
        if (slackWorkspaceId) {
          targetUrl = `https://app.slack.com/client/${slackWorkspaceId}/activity`;
        } else {
          return {
            success: false,
            error: 'Slack workspace ID not set. Please configure it in Settings.'
          };
        }
      }

      const newTab = await chrome.tabs.create({
        url: targetUrl,
        active: false // Open in background, don't steal focus
      });

      // Wait for the tab to load
      await waitForTabLoad(newTab.id);

      // Add to matching tabs list
      matchingTabs = [newTab];
    } catch (err) {
      return {
        success: false,
        error: `Failed to open ${service} tab: ${err.message}`
      };
    }
  }

  // Try each matching tab until one responds
  for (const tab of matchingTabs) {
    try {
      await ensureContentScript(tab.id, service);

      const response = await sendMessageToTab(tab.id, {
        type: SCRAPE_MSG_TYPES[service]
      });

      if (response && response.success) {
        cache[service] = { data: response.data, timestamp: Date.now() };
        return { success: true, data: response.data };
      }
    } catch (err) {
      console.log(`[HOME] Tab ${tab.id} scrape failed:`, err.message);
      continue;
    }
  }

  return {
    success: false,
    error: `Could not scrape ${service}. Try refreshing the ${service} tab.`
  };
}

// ────── Wait for Tab to Finish Loading ──────
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        // Give the page a moment to render (SPA initialization)
        setTimeout(() => resolve(), 2000);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Also check if already loaded
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => resolve(), 2000);
      }
    });
  });
}

// ────── Safe Tab Messaging with Timeout ──────
function sendMessageToTab(tabId, message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Content script timed out'));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ────── Ensure Content Script is Loaded ──────
async function ensureContentScript(tabId, service) {
  const scriptMap = {
    github: 'content/github.js',
    slack: 'content/slack.js',
    calendar: 'content/calendar.js'
  };

  try {
    // Ping to check if script is already loaded
    await sendMessageToTab(tabId, { type: 'PING' }, 1000);
  } catch {
    // Not loaded — inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [scriptMap[service]]
      });
      // Give the script a moment to register its listener
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.log(`[HOME] Failed to inject ${service} script:`, err.message);
      throw err; // let the caller know injection failed
    }
  }
}

function notifyTabsChanged(windowId) {
  if (windowId != null) {
    chrome.runtime.sendMessage({ type: 'TABS_CHANGED', windowId }).catch(() => {});
  }
}

// ────── Tab info cache (for recently-closed tracking) ──────
const tabInfoCache = {};

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url) tabInfoCache[tab.id] = { url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '' };
  notifyTabsChanged(tab.windowId);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const info = tabInfoCache[tabId];
  if (info && info.url && !info.url.startsWith('chrome://') && !info.url.startsWith('edge://') && !removeInfo.isWindowClosing) {
    chrome.runtime.sendMessage({
      type: 'TAB_CLOSED',
      windowId: removeInfo.windowId,
      tab: info
    }).catch(() => {});
  }
  delete tabInfoCache[tabId];
  notifyTabsChanged(removeInfo.windowId);
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  if (moveInfo.windowId != null) notifyTabsChanged(moveInfo.windowId);
});

// ────── Auto-refresh on Tab Updates ──────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Keep tab info cache up to date
  if (tab.url) tabInfoCache[tab.id] = { url: tab.url, title: tab.title || tab.url, favIconUrl: tab.favIconUrl || '' };
  notifyTabsChanged(tab.windowId);

  if (changeInfo.status !== 'complete' || !tab.url) return;

  for (const [service, matcher] of Object.entries(SERVICE_MATCH)) {
    if (matcher(tab.url)) {
      // Invalidate cache
      delete cache[service];

      // Auto-scrape after page settles
      setTimeout(async () => {
        try {
          const result = await handleScrapeRequest(service);
          if (result.success) {
            chrome.runtime.sendMessage({
              type: 'SERVICE_UPDATE',
              service,
              data: result.data
            }).catch(() => {}); // side panel might not be open
          }
        } catch (e) {
          console.log(`[HOME] Auto-refresh failed for ${service}:`, e.message);
        }
      }, 2000);
    }
  }
});

// ────── Periodic Alarm Refresh + Auto-archive ──────
try {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'refresh-services') {
      for (const service of ['github', 'slack', 'calendar']) {
        try {
          const result = await handleScrapeRequest(service);
          if (result.success) {
            chrome.runtime.sendMessage({
              type: 'SERVICE_UPDATE',
              service,
              data: result.data
            }).catch(() => {});
          }
        } catch (e) {
          // Ignore individual service failures
        }
      }
      return;
    }

    if (alarm.name === 'auto-archive-tabs') {
      try {
        const { spaces = {}, windowIdToSpaceId = {} } = await chrome.storage.local.get(['spaces', 'windowIdToSpaceId']);
        const now = Date.now();
        const msPerHour = 60 * 60 * 1000;
        for (const [winIdStr, spaceId] of Object.entries(windowIdToSpaceId)) {
          const windowId = parseInt(winIdStr, 10);
          const space = spaces[spaceId];
          if (!space || !space.pinnedEntries) continue;
          const pinnedUrls = new Set(space.pinnedEntries.map(e => e.url));
          const hours = space.autoArchiveHours === 24 ? 24 : 12;
          const cutoff = now - hours * msPerHour;
          let tabs;
          try {
            tabs = await chrome.tabs.query({ windowId });
          } catch (_) {
            continue;
          }
          let groupIds = new Set();
          if (chrome.tabGroups) {
            try {
              const groups = await chrome.tabGroups.query({ windowId });
              groups.forEach(g => groupIds.add(g.id));
            } catch (_) {}
          }
          for (const tab of tabs) {
            if (!tab.id || !tab.url) continue;
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) continue;
            if (pinnedUrls.has(tab.url)) continue;
            if (tab.groupId != null && groupIds.has(tab.groupId)) continue;
            const last = tab.lastAccessed != null ? tab.lastAccessed : 0;
            if (last < cutoff) {
              try {
                await chrome.tabs.remove(tab.id);
              } catch (_) {}
            }
          }
        }
      } catch (e) {
        console.warn('[HOME] Auto-archive failed:', e.message);
      }
    }
  });
} catch (e) {
  console.warn('alarms.onAlarm not available:', e.message);
}

// ════════════════════════════════════════════
//  GITHUB FETCH-BASED SCRAPER (no tabs needed)
// ════════════════════════════════════════════
async function fetchGitHubPRs() {
  const urls = {
    created: 'https://github.com/pulls',
    reviewRequested: 'https://github.com/pulls/review-requested',
    assigned: 'https://github.com/pulls/assigned'
  };

  const [created, reviewRequested, assigned] = await Promise.all([
    fetchAndParsePRs(urls.created),
    fetchAndParsePRs(urls.reviewRequested),
    fetchAndParsePRs(urls.assigned)
  ]);

  const allPRs = [
    ...created.map(pr => ({ ...pr, section: 'created' })),
    ...reviewRequested.map(pr => ({ ...pr, section: 'review-requested' })),
    ...assigned.map(pr => ({ ...pr, section: 'assigned' }))
  ];

  // Deduplicate by URL
  const seen = new Set();
  const unique = allPRs.filter(pr => {
    if (seen.has(pr.url)) return false;
    seen.add(pr.url);
    return true;
  });

  console.log(`[HOME] Fetched ${unique.length} GitHub PRs`);
  return unique;
}

const FETCH_TIMEOUT_MS = 15000;

async function fetchAndParsePRs(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'text/html' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[HOME] GitHub ${url} returned ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parsePRsFromHTML(html);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error(`[HOME] GitHub fetch timed out: ${url}`);
    } else {
      console.error(`[HOME] GitHub fetch error:`, err);
    }
    return [];
  }
}

function parsePRsFromHTML(html) {
  const prs = [];
  const rowRegex = /<div[^>]*id="issue_\d+_[^"]*"[^>]*class="[^"]*js-issue-row[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*id="issue_\d+_|<\/div>\s*<\/div>\s*$)/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1];

    const repoMatch = rowHtml.match(/class="[^"]*Link--muted[^"]*"[^>]*>([^<]+)<\/a>/) ||
                      rowHtml.match(/data-hovercard-type="repository"[^>]*>([^<]+)<\/a>/);
    const repo = repoMatch ? repoMatch[1].trim() : '';

    const titleMatch = rowHtml.match(/class="[^"]*js-navigation-open[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/) ||
                       rowHtml.match(/data-hovercard-type="pull_request"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    const url = titleMatch ? 'https://github.com' + titleMatch[1] : '';
    const title = titleMatch ? titleMatch[2].replace(/<[^>]*>/g, '').trim() : '';

    const numberMatch = rowHtml.match(/#(\d+)/) || url.match(/\/pull\/(\d+)/);
    const number = numberMatch ? numberMatch[1] : '';

    let state = 'open';
    let draft = false;
    if (rowHtml.includes('color-fg-merged') || rowHtml.includes('merged')) state = 'merged';
    else if (rowHtml.includes('color-fg-closed') || rowHtml.includes('closed')) state = 'closed';
    if (rowHtml.includes('Draft') || rowHtml.includes('draft')) draft = true;

    let reviewStatus = '';
    if (rowHtml.includes('octicon-check') || rowHtml.includes('Approved')) reviewStatus = 'approved';
    else if (rowHtml.includes('octicon-dot-fill') || rowHtml.includes('Changes requested')) reviewStatus = 'changes-requested';
    else if (rowHtml.includes('Review required')) reviewStatus = 'review';

    const timeMatch = rowHtml.match(/<relative-time[^>]*>([\s\S]*?)<\/relative-time>/) ||
                      rowHtml.match(/datetime="[^"]*"[^>]*>([^<]+)</);
    const time = timeMatch ? timeMatch[1].trim() : '';

    const commentMatch = rowHtml.match(/aria-label="(\d+) comment[s]?"/) ||
                         rowHtml.match(/>(\d+)<\/a>\s*<\/span>\s*<svg[^>]*class="[^"]*octicon-comment/);
    const comments = commentMatch ? commentMatch[1] : '';

    if (title && url) {
      prs.push({ title, url, repo, state, draft, reviewStatus, time, comments, number, section: '' });
    }
  }

  return prs;
}

console.log('[HOME] Service worker initialized');
