/* ═══════════════════════════════════════════
   Content Script: Google Calendar Scraper
   Runs on: calendar.google.com/*
   ═══════════════════════════════════════════ */

(() => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'SCRAPE_CALENDAR') return false;

    try {
      const data = scrapeCalendar();
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }

    return true;
  });

  function scrapeCalendar() {
    const events = [];
    const url = window.location.href;

    // Strategy 1: Day view (most detailed)
    // Strategy 2: Week view
    // Strategy 3: Schedule/agenda view
    // Strategy 4: Aria-based scraping (most reliable across layouts)

    // Try aria-based approach first — Google Calendar renders events with data attributes
    const eventChips = document.querySelectorAll(
      '[data-eventid], ' +
      '[data-eventchip], ' +
      '.NlL62b, ' +           // Day/week event blocks
      '.oKAzhe, ' +           // Timed events
      '.rb24Gb, ' +           // All-day events
      '[data-eventkey]'
    );

    if (eventChips.length > 0) {
      eventChips.forEach(chip => {
        const evt = parseEventChip(chip);
        if (evt) events.push(evt);
      });
    }

    // Also try the agenda/schedule view
    if (events.length === 0) {
      const agendaItems = document.querySelectorAll(
        '[data-datekey], .jKgTtb, [data-eventid]'
      );
      agendaItems.forEach(item => {
        const evt = parseAgendaItem(item);
        if (evt) events.push(evt);
      });
    }

    // Fallback: try generic aria labels
    if (events.length === 0) {
      const ariaEvents = document.querySelectorAll('[aria-label*=":"], [role="button"][data-eventid]');
      ariaEvents.forEach(el => {
        const evt = parseAriaEvent(el);
        if (evt) events.push(evt);
      });
    }

    // Deduplicate by title + time
    const seen = new Set();
    const unique = events.filter(e => {
      const key = `${e.title}|${e.timeDisplay}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by time
    unique.sort((a, b) => {
      if (a.startTime && b.startTime) return new Date(a.startTime) - new Date(b.startTime);
      if (a.timeDisplay && b.timeDisplay) return a.timeDisplay.localeCompare(b.timeDisplay);
      return 0;
    });

    return unique;
  }

  function parseEventChip(chip) {
    // Get aria-label which often contains full event info
    const ariaLabel = chip.getAttribute('aria-label') || '';
    const innerText = chip.textContent?.trim() || '';

    // Try to extract from aria-label first (format: "Event title, Time, Location, Calendar")
    if (ariaLabel) {
      return parseAriaLabel(ariaLabel, chip);
    }

    // Fallback to visible text
    if (!innerText) return null;

    // Try to parse time from the text
    const timeMatch = innerText.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/);
    const time = timeMatch ? `${timeMatch[1]} – ${timeMatch[2]}` : '';
    const title = timeMatch ? innerText.replace(timeMatch[0], '').trim() : innerText;

    return {
      title: title || innerText,
      timeDisplay: time,
      startTime: '',
      endTime: '',
      location: '',
      url: '',
      calendarName: ''
    };
  }

  function parseAriaLabel(label, el) {
    // Common format: "Meeting Title, October 15, 2024, 10:00 AM to 11:00 AM, Conference Room"
    // Or: "Meeting Title, 10:00 – 11:00"
    const parts = label.split(',').map(s => s.trim());

    if (parts.length === 0) return null;

    const title = parts[0] || '';

    // Try to find time patterns
    let timeDisplay = '';
    let startTime = '';
    let endTime = '';
    let location = '';

    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      // Match time range
      if (p.match(/\d{1,2}(:\d{2})?\s*(AM|PM|am|pm)?\s*(to|–|-)\s*\d{1,2}(:\d{2})?\s*(AM|PM|am|pm)?/)) {
        timeDisplay = p;
      }
      // Match single time
      else if (p.match(/^\d{1,2}:\d{2}\s*(AM|PM|am|pm)?$/)) {
        if (!timeDisplay) timeDisplay = p;
      }
      // Skip date patterns
      else if (p.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i)) {
        continue;
      }
      // Everything else might be location
      else if (p.length > 2 && !p.match(/^\d+$/)) {
        location = p;
      }
    }

    // Try to extract event URL from parent link
    const linkEl = el.closest('a') || el.querySelector('a');
    const url = linkEl?.href || '';

    return {
      title,
      timeDisplay,
      startTime,
      endTime,
      location,
      url,
      calendarName: ''
    };
  }

  function parseAgendaItem(item) {
    const titleEl = item.querySelector('[data-eventid], .oKAzhe, .NlL62b');
    const title = titleEl?.textContent?.trim() || item.textContent?.trim() || '';

    if (!title) return null;

    const ariaLabel = item.getAttribute('aria-label') || titleEl?.getAttribute('aria-label') || '';
    if (ariaLabel) return parseAriaLabel(ariaLabel, item);

    return {
      title,
      timeDisplay: '',
      startTime: '',
      endTime: '',
      location: '',
      url: '',
      calendarName: ''
    };
  }

  function parseAriaEvent(el) {
    const label = el.getAttribute('aria-label') || '';
    if (!label) return null;
    return parseAriaLabel(label, el);
  }
})();
