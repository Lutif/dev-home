/* ═══════════════════════════════════════════
   Content Script: Slack Mentions Scraper
   Runs on: app.slack.com/*
   ═══════════════════════════════════════════ */

(() => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'SCRAPE_SLACK') return false;

    try {
      const data = scrapeSlack();
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }

    return true;
  });

  function scrapeSlack() {
    const messages = [];

    // ONLY scrape if we're on the /activity page
    const isActivityPage = window.location.pathname.includes('/activity');

    if (!isActivityPage) {
      return [{
        sender: '',
        text: 'Please navigate to the Activity page to see mentions',
        time: '',
        avatar: '',
        url: '',
        channel: 'Info',
        sortTs: 0
      }];
    }

    // Strategy 1: Scrape from the Activity feed (/activity page)
    // ONLY select activity item containers with specific data-qa attribute
    // This ensures we NEVER match channel messages
    const activityItems = document.querySelectorAll(
      '[data-qa="activity-item-container"]'
    );

    if (!activityItems || activityItems.length === 0) {
      return [{
        sender: '',
        text: 'No activity items found. Try refreshing the page.',
        time: '',
        avatar: '',
        url: '',
        channel: 'Info',
        sortTs: 0
      }];
    }

    if (activityItems.length > 0) {
      activityItems.forEach(el => {
        const msg = parseActivityItem(el);
        if (msg) messages.push(msg);
      });
      if (messages.length > 0) return messages;
    }

    // If no messages found, return helpful message
    return [{
      sender: '',
      text: 'No activity items found. Try refreshing the page.',
      time: '',
      avatar: '',
      url: '',
      channel: 'Info',
      sortTs: 0
    }];
  }

  function parseActivityItem(el) {
    // Parse based on actual Slack activity page structure

    // Sender(s) - from the primary senders section
    let sender = '';
    const senderEl = el.querySelector(
      '[data-qa="activity_ia4_page_item_senders_primary_dms"], ' +
      '.p-activity_ia4_page__item__senders__primary, ' +
      '[data-qa="dms-channel-sender-name"]'
    );
    if (senderEl) {
      sender = senderEl.textContent?.trim() || '';
      // Clean up "and" to "&" for brevity
      sender = sender.replace(/ and /g, ' & ');
    }

    // Message text - from activity-item-message
    let text = '';
    const textEl = el.querySelector('[data-qa="activity-item-message"]');
    if (textEl) {
      text = textEl.textContent?.trim() || '';
    }

    if (!text && !sender) return null;

    // Avatar - get the top stacked image
    const avatarEl = el.querySelector(
      '.c-base_icon_image_stacked__image--top, ' +
      'img.c-base_icon_image_stacked__image, ' +
      'img[src*="slack-edge"]'
    );
    const avatar = avatarEl?.src || '';

    // Timestamp - from header secondary section
    let time = '';
    const timeEl = el.querySelector('.p-activity_ia4_page__item__header__secondary');
    if (timeEl) {
      // Get just the time text, not the badge
      const timeSpan = timeEl.querySelector('span');
      time = timeSpan?.textContent?.trim() || '';
    }

    // Channel name - from inline channel entity
    let channel = '';
    const channelEl = el.querySelector(
      '[data-qa="inline_channel_entity_name"], ' +
      '.c-channel_entity__name, ' +
      '[data-qa="inline_channel_entity"] .c-inline_channel_entity__content'
    );
    if (channelEl) {
      channel = channelEl.textContent?.trim() || '';
    }

    // URL - find link to the thread or message
    const linkEl = el.querySelector(
      'a[href*="/archives/"], ' +
      'a[href*="/team/"], ' +
      '.c-link[href*="slack.com"]'
    );
    const url = linkEl?.href || '';

    // Sort timestamp - use current time as we don't have exact timestamp
    const sortTs = Date.now();

    return { sender, text, time, avatar, url, channel, sortTs };
  }

})();
