'use strict';

const PALETTE = Object.freeze({
  blue: '#1CB0F6',
  blueShade: '#1899D6',
  gold: '#FFC800',
  goldShade: '#B88600',
  green: '#58CC02',
  greenShade: '#3F8F00',
  neutral: '#777777',
  white: '#FFFFFF'
});

const THEMES = Object.freeze({
  dark: Object.freeze({
    canvas: '#17181C',
    secondary: '#C5C7CB',
    subtle: '#34373D',
    surface: '#24262B',
    text: '#F7F7F7'
  }),
  light: Object.freeze({
    canvas: '#F7F7F7',
    secondary: '#686868',
    subtle: '#EEEEEE',
    surface: '#FFFFFF',
    text: '#3C3C3C'
  })
});

const MONTH_LABELS = Object.freeze([
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
]);

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function toDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function formatCompactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(number >= 10_000_000_000 ? 0 : 1)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : 1)}K`;
  return Math.round(number).toLocaleString('en-US');
}

function formatKrw(value) {
  const number = Math.max(0, Number(value) || 0);
  if (number >= 1_000_000) return `₩${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
  if (number >= 100_000) return `₩${Math.round(number / 1_000)}K`;
  return `₩${Math.round(number).toLocaleString('en-US')}`;
}

function formatMonthLabel(month) {
  const monthNumber = Number(String(month || '').slice(5, 7));
  return MONTH_LABELS[monthNumber - 1] || String(month || '').slice(5);
}

function resolveTheme(themeName) {
  return THEMES[themeName] || THEMES.light;
}

function headerTextColor(accent) {
  return accent === PALETTE.blue || accent === PALETTE.neutral
    ? PALETTE.white
    : '#2F2F2F';
}

function valueColor(themeName, accent, shade) {
  return themeName === 'dark' ? accent : shade;
}

function flatFrame(themeName, contents) {
  const theme = resolveTheme(themeName);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="18" fill="${theme.canvas}"/>
  <rect x="2" y="2" width="140" height="140" rx="17" fill="${theme.surface}"/>
  ${contents}
</svg>`;
}

function getStatusDisplay(status) {
  if (status.state === 'working') {
    return {
      accent: PALETTE.gold,
      detail: status.activeTasks === 1 ? '1 ACTIVE TASK' : `${status.activeTasks} ACTIVE TASKS`,
      label: 'WORKING',
      shade: PALETTE.goldShade
    };
  }
  if (status.state === 'complete') {
    return {
      accent: PALETTE.green,
      detail: 'ALL TASKS IDLE',
      label: 'READY',
      shade: PALETTE.greenShade
    };
  }
  return {
    accent: PALETTE.neutral,
    detail: 'NO LOCAL PROCESS',
    label: 'OFFLINE',
    shade: '#5F5F5F'
  };
}

function renderStatus(status, themeName = 'light') {
  const theme = resolveTheme(themeName);
  const display = getStatusDisplay(status);
  const sessionLabel = status.sessionCount === 1 ? '1 SESSION' : `${status.sessionCount} SESSIONS`;
  const contents = `<rect x="10" y="9" width="124" height="29" rx="14.5" fill="${display.accent}"/>
  <circle cx="25" cy="23.5" r="5.5" fill="${headerTextColor(display.accent)}"/>
  <text x="78" y="29" fill="${headerTextColor(display.accent)}" font-family="sans-serif" font-size="14" font-weight="900" text-anchor="middle">CODEX</text>
  <text x="72" y="75" fill="${valueColor(themeName, display.accent, display.shade)}" font-family="sans-serif" font-size="23" font-weight="900" text-anchor="middle">${display.label}</text>
  <text x="72" y="98" fill="${theme.text}" font-family="sans-serif" font-size="11.5" font-weight="850" text-anchor="middle">${escapeXml(display.detail)}</text>
  <rect x="14" y="108" width="116" height="25" rx="12.5" fill="${theme.subtle}"/>
  <text x="72" y="125" fill="${theme.secondary}" font-family="sans-serif" font-size="10.5" font-weight="850" text-anchor="middle">${escapeXml(sessionLabel)}</text>`;
  return toDataUrl(flatFrame(themeName, contents));
}

function usageFrame({ accent, cost, header, shade, tokens }, themeName) {
  const theme = resolveTheme(themeName);
  const contents = `<rect x="9" y="8" width="126" height="30" rx="15" fill="${accent}"/>
  <text x="72" y="28" fill="${headerTextColor(accent)}" font-family="sans-serif" font-size="13" font-weight="900" text-anchor="middle">${escapeXml(header)}</text>
  <text x="72" y="78" fill="${theme.text}" font-family="sans-serif" font-size="34" font-weight="900" text-anchor="middle">${escapeXml(tokens)}</text>
  <text x="72" y="94" fill="${theme.secondary}" font-family="sans-serif" font-size="10" font-weight="850" text-anchor="middle">TOKENS</text>
  <rect x="12" y="102" width="120" height="31" rx="15.5" fill="${theme.subtle}"/>
  <text x="72" y="124" fill="${valueColor(themeName, accent, shade)}" font-family="sans-serif" font-size="18" font-weight="900" text-anchor="middle">${escapeXml(cost)}</text>`;
  return toDataUrl(flatFrame(themeName, contents));
}

function getSummaryViews() {
  return [{ type: 'month' }, { type: 'today' }];
}

function renderUsageSummary(snapshot, requestedIndex = 0, themeName = 'light') {
  const views = getSummaryViews();
  const viewIndex = ((requestedIndex % views.length) + views.length) % views.length;
  const view = views[viewIndex];
  const isMonth = view.type === 'month';
  const summary = isMonth ? snapshot.monthly : snapshot.daily;
  const accent = isMonth ? PALETTE.blue : PALETTE.green;
  const shade = isMonth ? PALETTE.blueShade : PALETTE.greenShade;

  return {
    image: usageFrame({
      accent,
      cost: formatKrw(summary.totalKrw),
      header: isMonth
        ? `${formatMonthLabel(snapshot.month)} ${summary.sessionCount}S`
        : `TODAY ${summary.sessionCount}S`,
      shade,
      tokens: formatCompactNumber(summary.usage.totalTokens)
    }, themeName),
    viewCount: views.length,
    viewIndex,
    viewType: view.type
  };
}

function renderSessionUsage(snapshot, requestedIndex = 0, themeName = 'light') {
  const viewCount = Math.max(1, snapshot.sessions.length);
  const viewIndex = ((requestedIndex % viewCount) + viewCount) % viewCount;
  const session = snapshot.sessions[viewIndex];

  if (!session) {
    return {
      image: usageFrame({
        accent: PALETTE.gold,
        cost: '₩0',
        header: 'TODAY SESSION',
        shade: PALETTE.goldShade,
        tokens: '0'
      }, themeName),
      viewCount,
      viewIndex,
      viewType: 'session-empty'
    };
  }

  return {
    image: usageFrame({
      accent: PALETTE.gold,
      cost: formatKrw(session.totalKrw),
      header: `SESSION ${viewIndex + 1}/${snapshot.sessions.length}`,
      shade: PALETTE.goldShade,
      tokens: formatCompactNumber(session.usage.totalTokens)
    }, themeName),
    viewCount,
    viewIndex,
    viewType: 'session'
  };
}

module.exports = {
  PALETTE,
  THEMES,
  escapeXml,
  formatCompactNumber,
  formatKrw,
  formatMonthLabel,
  getStatusDisplay,
  getSummaryViews,
  renderSessionUsage,
  renderStatus,
  renderUsageSummary
};
