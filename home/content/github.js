/* ═══════════════════════════════════════════
   Content Script: GitHub PR Scraper
   Runs on: github.com/*
   ═══════════════════════════════════════════ */

(() => {
  // Listen for scrape requests from the background worker
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'SCRAPE_GITHUB') return false;

    try {
      const data = scrapeGitHub();
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }

    return true; // keep channel open for async
  });

  function scrapeGitHub() {
    const url = window.location.href;

    // If on the pulls dashboard (github.com/pulls)
    if (url.includes('github.com/pulls')) {
      return scrapePullsDashboard();
    }

    // If on a specific repo's PR list
    if (url.match(/github\.com\/[^/]+\/[^/]+\/pulls/)) {
      return scrapeRepoPulls();
    }

    // If on a specific PR page
    if (url.match(/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)) {
      return scrapeSinglePR();
    }

    // Fallback: try pulls dashboard selectors, then generic
    return scrapePullsDashboard();
  }

  // ────── github.com/pulls (main dashboard) ──────
  function scrapePullsDashboard() {
    const prs = [];

    // GitHub's dashboard groups PRs into sections
    // Try the newer React-based UI first
    const issueRows = document.querySelectorAll('[data-testid="issue-row"], .js-issue-row, [id^="issue_"]');

    if (issueRows.length > 0) {
      issueRows.forEach(row => {
        const pr = parsePRRow(row);
        if (pr) prs.push(pr);
      });
      return prs;
    }

    // Try the classic list view
    const listItems = document.querySelectorAll('.Box-row, .js-navigation-item');
    listItems.forEach(item => {
      const pr = parsePRRow(item);
      if (pr) prs.push(pr);
    });

    return prs;
  }

  function parsePRRow(row) {
    // Title link
    const titleEl = row.querySelector('a[data-hovercard-type="pull_request"], a[id^="issue_"], .markdown-title, a.Link--primary');
    if (!titleEl) return null;

    const title = titleEl.textContent.trim();
    const url = titleEl.href || '';

    // Repo name
    const repoEl = row.querySelector('a[data-hovercard-type="repository"], .text-small a');
    const repo = repoEl ? repoEl.textContent.trim() : extractRepoFromUrl(url);

    // Status / state
    const openIcon = row.querySelector('.octicon-git-pull-request');
    const mergedIcon = row.querySelector('.octicon-git-merge');
    const closedIcon = row.querySelector('.octicon-git-pull-request-closed');
    const draftIcon = row.querySelector('.octicon-git-pull-request-draft');

    let state = 'open';
    let draft = false;
    if (mergedIcon) state = 'merged';
    else if (closedIcon) state = 'closed';
    else if (draftIcon) { state = 'open'; draft = true; }

    // Review status
    const reviewIcons = row.querySelectorAll('.octicon-check, .octicon-x, .octicon-dot-fill');
    let reviewStatus = '';
    if (row.querySelector('.octicon-file-diff, [aria-label*="review"]')) {
      reviewStatus = 'review';
    }

    // Time
    const timeEl = row.querySelector('relative-time, time');
    const time = timeEl ? timeEl.getAttribute('title') || timeEl.textContent.trim() : '';

    // Comments count
    const commentEl = row.querySelector('.octicon-comment');
    const comments = commentEl ? commentEl.parentElement?.textContent?.trim() : '';

    // Section (from parent container)
    let section = '';
    const sectionHeader = row.closest('[aria-label]');
    if (sectionHeader) {
      const label = sectionHeader.getAttribute('aria-label').toLowerCase();
      if (label.includes('review')) section = 'review-requested';
      else if (label.includes('created') || label.includes('your')) section = 'created';
      else if (label.includes('assigned')) section = 'assigned';
    }

    return { title, url, repo, state, draft, reviewStatus, time, comments, section };
  }

  // ────── Repo PR list ──────
  function scrapeRepoPulls() {
    const prs = [];
    const repo = window.location.pathname.split('/').slice(1, 3).join('/');

    document.querySelectorAll('.js-issue-row, [id^="issue_"], [data-testid="issue-row"]').forEach(row => {
      const pr = parsePRRow(row);
      if (pr) {
        pr.repo = repo;
        prs.push(pr);
      }
    });

    return prs;
  }

  // ────── Single PR page ──────
  function scrapeSinglePR() {
    const title = document.querySelector('.js-issue-title, .gh-header-title span')?.textContent?.trim() || document.title;
    const repo = window.location.pathname.split('/').slice(1, 3).join('/');
    const url = window.location.href;

    // State from sidebar/header
    const stateEl = document.querySelector('.State, [title="Status: Open"], [title="Status: Merged"], [title="Status: Closed"]');
    let state = 'open';
    if (stateEl) {
      const txt = stateEl.textContent.toLowerCase();
      if (txt.includes('merged')) state = 'merged';
      else if (txt.includes('closed')) state = 'closed';
    }

    const draft = !!document.querySelector('.octicon-git-pull-request-draft, [title*="Draft"]');

    return [{ title, url, repo, state, draft, reviewStatus: '', time: '', comments: '', section: '' }];
  }

  function extractRepoFromUrl(url) {
    try {
      const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
      return match ? match[1] : '';
    } catch { return ''; }
  }
})();
