# HOME — Chrome Extension

## Overview
A productivity command center Chrome extension that brings workspaces, GitHub PRs, Slack mentions, and Google Calendar events into a single side panel. **Zero-auth architecture** — all data is scraped from the user's already logged-in browser sessions.

## Architecture

### Manifest V3 + Side Panel API
- `manifest.json` — MV3 with `sidePanel`, `tabs`, `storage`, `scripting`, `activeTab` permissions
- `host_permissions` for `github.com`, `app.slack.com`, `calendar.google.com`

### Key Files
```
home/
├── manifest.json           # Extension manifest (MV3)
├── background.js           # Service worker — tab discovery, message routing, caching, auto-refresh
├── sidepanel.html          # Side panel entry point
├── sidepanel.js            # UI controller — tabs, rendering, workspace CRUD
├── sidepanel.css           # Dark theme styles
├── content/
│   ├── github.js           # Scrapes PRs from github.com (pulls dashboard, repo PRs, single PR)
│   ├── slack.js            # Scrapes mentions/messages from app.slack.com
│   └── calendar.js         # Scrapes events from calendar.google.com
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── claude.md               # This file — project knowledge base
```

### Data Flow
1. User clicks extension icon → side panel opens
2. User switches to GitHub/Slack/Calendar tab in side panel
3. `sidepanel.js` sends `SCRAPE_SERVICE` message to `background.js`
4. `background.js` finds open tabs matching that service's URL pattern
   - **Auto-tab-opening**: If no matching tab exists, automatically creates one in the background (`active: false`)
   - Waits for tab to finish loading (status: 'complete' + 2s settle time for SPA rendering)
5. `background.js` sends scrape message (`SCRAPE_GITHUB`, etc.) to the content script in that tab
6. Content script scrapes DOM and returns structured data
7. `background.js` caches result (2min TTL) and sends back to side panel
8. `sidepanel.js` renders the data as cards

**Why tabs instead of fetch?** GitHub/Slack/Calendar are JavaScript-rendered SPAs. `fetch()` only gets the HTML shell, not the actual data. We need a real browser context where JavaScript executes and the page renders. Auto-opened tabs are created in the background to avoid interrupting the user.

### Auto-refresh
- `background.js` watches `chrome.tabs.onUpdated` to invalidate cache when service tabs reload
- 5-minute periodic alarm re-scrapes all services
- `SERVICE_UPDATE` messages pushed to side panel for live updates

### Content Script Injection
- Declared in manifest for auto-injection on matching URLs
- Fallback: `chrome.scripting.executeScript` if content script didn't load (e.g., tab was open before extension installed)

## Workspaces Feature
- Save all current window tabs as a named workspace
- Stored in `chrome.storage.local`
- Restore opens all saved tabs
- Click card to expand/collapse tab list

## Scraping Strategies

### GitHub (fetch-based, no tabs needed)
- **Method**: `fetch()` with `credentials: 'include'` + regex HTML parsing
- **URLs scraped**:
  - `github.com/pulls` — your created PRs
  - `github.com/pulls/review-requested` — PRs requesting your review
  - `github.com/pulls/assigned` — PRs assigned to you
- **Why it works**: GitHub's `/pulls` pages are server-rendered with PR data in the initial HTML (not a pure SPA)
- **Parsing**: Regex extracts data from `<div id="issue_*" class="js-issue-row">` elements
- **Deduplication**: PRs can appear in multiple categories, deduplicated by URL
- **Fallback**: `content/github.js` still exists for tab-based scraping if fetch fails

### Slack (`content/slack.js`)
- Scrapes visible messages in current channel/DM
- Falls back to sidebar unread channels with badge counts
- Targets: `[data-qa="virtual-list-item"]`, `.c-message_kit__message`, sidebar `.p-channel_sidebar__channel--unread`

### Google Calendar (`content/calendar.js`)
- Parses `aria-label` attributes on event chips (most reliable)
- Handles day view, week view, and agenda view
- Deduplicates by title+time, sorts chronologically
- Targets: `[data-eventid]`, `[data-eventchip]`, `.NlL62b`, `.oKAzhe`

## Design
- Dark theme (dark bg: #0f1117, surface: #1a1d27, primary: #6366f1 indigo)
- Compact cards with hover highlights
- Green dots on tabs with active data
- Status indicators: connected (green), scanning (yellow), error (red)
- All inline SVG icons (no external dependencies)

## Potential Improvements
- [ ] Workspace tab group integration (Chrome Tab Groups API)
- [ ] Keyboard shortcuts for tab switching
- [ ] Notification badges on extension icon
- [ ] Settings panel for cache TTL, auto-refresh interval
- [ ] GitHub: filter by org/repo
- [ ] Slack: navigate directly to message in Slack
- [ ] Calendar: show next N days, not just today
- [ ] Export workspace as shareable URL list
