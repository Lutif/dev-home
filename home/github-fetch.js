/* ═══════════════════════════════════════════
   GitHub PR Fetcher (fetch-based, no tabs needed)
   Uses fetch() + HTML regex parsing to scrape PRs
   ═══════════════════════════════════════════ */

async function fetchGitHubPRs() {
  try {
    const urls = {
      created: 'https://github.com/pulls',
      reviewRequested: 'https://github.com/pulls/review-requested',
      assigned: 'https://github.com/pulls/assigned'
    };

    // Fetch all three categories in parallel
    const [created, reviewRequested, assigned] = await Promise.all([
      fetchAndParsePRs(urls.created),
      fetchAndParsePRs(urls.reviewRequested),
      fetchAndParsePRs(urls.assigned)
    ]);

    // Tag each PR with its section
    const allPRs = [
      ...created.map(pr => ({ ...pr, section: 'created' })),
      ...reviewRequested.map(pr => ({ ...pr, section: 'review-requested' })),
      ...assigned.map(pr => ({ ...pr, section: 'assigned' }))
    ];

    // Deduplicate by URL (a PR can appear in multiple categories)
    const seen = new Set();
    const unique = allPRs.filter(pr => {
      if (seen.has(pr.url)) return false;
      seen.add(pr.url);
      return true;
    });

    console.log(`[GitHubFetch] Fetched ${unique.length} PRs across all categories`);
    return unique;
  } catch (err) {
    console.error('[GitHubFetch] Failed:', err);
    throw err;
  }
}

async function fetchAndParsePRs(url) {
  try {
    const response = await fetch(url, {
      credentials: 'include', // Include cookies for authentication
      headers: { 'Accept': 'text/html' }
    });

    if (!response.ok) {
      console.error(`[GitHubFetch] ${url} returned ${response.status}`);
      return [];
    }

    const html = await response.text();
    return parsePRsFromHTML(html);
  } catch (err) {
    console.error(`[GitHubFetch] Error fetching ${url}:`, err);
    return [];
  }
}

function parsePRsFromHTML(html) {
  const prs = [];

  // Match PR rows: <div id="issue_123_..." class="...js-issue-row...">
  const rowRegex = /<div[^>]*id="issue_\d+_[^"]*"[^>]*class="[^"]*js-issue-row[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*id="issue_\d+_|<\/div>\s*<\/div>\s*$)/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const rowHtml = match[1];

    // Extract repo name
    const repoMatch = rowHtml.match(/class="[^"]*Link--muted[^"]*"[^>]*>([^<]+)<\/a>/) ||
                      rowHtml.match(/data-hovercard-type="repository"[^>]*>([^<]+)<\/a>/);
    const repo = repoMatch ? repoMatch[1].trim() : '';

    // Extract title and URL
    const titleMatch = rowHtml.match(/class="[^"]*js-navigation-open[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/) ||
                       rowHtml.match(/data-hovercard-type="pull_request"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    const url = titleMatch ? 'https://github.com' + titleMatch[1] : '';
    const title = titleMatch ? titleMatch[2].replace(/<[^>]*>/g, '').trim() : '';

    // Extract PR number
    const numberMatch = rowHtml.match(/#(\d+)/) || url.match(/\/pull\/(\d+)/);
    const number = numberMatch ? numberMatch[1] : '';

    // Determine state
    let state = 'open';
    let draft = false;
    if (rowHtml.includes('color-fg-merged') || rowHtml.includes('merged')) state = 'merged';
    else if (rowHtml.includes('color-fg-closed') || rowHtml.includes('closed')) state = 'closed';
    if (rowHtml.includes('Draft') || rowHtml.includes('draft')) draft = true;

    // Review status
    let reviewStatus = '';
    if (rowHtml.includes('octicon-check') || rowHtml.includes('Approved')) reviewStatus = 'approved';
    else if (rowHtml.includes('octicon-dot-fill') || rowHtml.includes('Changes requested')) reviewStatus = 'changes-requested';
    else if (rowHtml.includes('Review required')) reviewStatus = 'review';

    // Extract time (relative time like "2 hours ago")
    const timeMatch = rowHtml.match(/<relative-time[^>]*>([\s\S]*?)<\/relative-time>/) ||
                      rowHtml.match(/datetime="[^"]*"[^>]*>([^<]+)</);
    const time = timeMatch ? timeMatch[1].trim() : '';

    // Extract comment count
    const commentMatch = rowHtml.match(/aria-label="(\d+) comment[s]?"/) ||
                         rowHtml.match(/>(\d+)<\/a>\s*<\/span>\s*<svg[^>]*class="[^"]*octicon-comment/);
    const comments = commentMatch ? commentMatch[1] : '';

    if (title && url) {
      prs.push({
        title,
        url,
        repo,
        state,
        draft,
        reviewStatus,
        time,
        comments,
        number,
        section: '' // will be set by caller
      });
    }
  }

  return prs;
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchGitHubPRs };
}
