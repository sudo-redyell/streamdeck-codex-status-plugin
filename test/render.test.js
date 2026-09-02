'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  renderSessionUsage,
  renderStatus,
  renderUsageSummary
} = require('../plugin/io.github.streamdeck-codex-status.sdPlugin/lib/render');

function decode(image) {
  return Buffer.from(image.split(',')[1], 'base64').toString('utf8');
}

function snapshot() {
  const usage = { totalTokens: 1_250_000 };
  return {
    month: '2026-09',
    monthly: { fallbackPriced: false, sessionCount: 3, totalKrw: 12_340, usage },
    daily: { fallbackPriced: false, sessionCount: 2, totalKrw: 2_500, usage: { totalTokens: 245_000 } },
    sessions: [
      { fallbackPriced: false, name: 'streamdeck-dashboard', totalKrw: 1_700, usage: { totalTokens: 150_000 } },
      { fallbackPriced: true, name: 'another', totalKrw: 800, usage: { totalTokens: 95_000 } }
    ]
  };
}

test('상태 화면은 그림자와 stroke 없이 축소된 마진을 사용한다', () => {
  const svg = decode(renderStatus({ state: 'working', activeTasks: 2, sessionCount: 3 }));
  assert.match(svg, /width="144"/);
  assert.match(svg, /x="2" y="2" width="140" height="140"/);
  assert.doesNotMatch(svg, /stroke=/);
  assert.match(svg, /WORKING/);
  assert.match(svg, /3 SESSIONS/);
});

test('모든 화면은 독립적인 다크 테마를 지원한다', () => {
  const status = decode(renderStatus({ state: 'complete', activeTasks: 0, sessionCount: 1 }, 'dark'));
  const summary = decode(renderUsageSummary(snapshot(), 0, 'dark').image);
  const session = decode(renderSessionUsage(snapshot(), 0, 'dark').image);
  for (const svg of [status, summary, session]) {
    assert.match(svg, /#17181C/);
    assert.match(svg, /#F7F7F7/);
    assert.doesNotMatch(svg, /stroke=/);
  }
});

test('버튼 2는 월 합계와 오늘 합계만 순환한다', () => {
  const data = snapshot();
  const month = renderUsageSummary(data, 0);
  const today = renderUsageSummary(data, 1);
  const wrapped = renderUsageSummary(data, 2);
  assert.equal(month.viewCount, 2);
  assert.equal(month.viewType, 'month');
  assert.match(decode(month.image), /SEP 3S/);
  assert.equal(today.viewType, 'today');
  assert.match(decode(today.image), /TODAY/);
  assert.equal(wrapped.viewType, 'month');
});

test('버튼 3은 오늘 세션만 최신순으로 순환한다', () => {
  const data = snapshot();
  const first = renderSessionUsage(data, 0);
  const second = renderSessionUsage(data, 1);
  const wrapped = renderSessionUsage(data, 2);
  assert.equal(first.viewCount, 2);
  assert.match(decode(first.image), /SESSION 1\/2/);
  assert.match(decode(second.image), /SESSION 2\/2/);
  assert.equal(wrapped.viewIndex, 0);
});

test('당일 세션이 없으면 명확한 빈 상태를 표시한다', () => {
  const data = snapshot();
  data.sessions = [];
  const rendered = renderSessionUsage(data);
  assert.equal(rendered.viewType, 'session-empty');
  assert.match(decode(rendered.image), /TODAY SESSION/);
});

test('요약·세션 화면에서 추정치와 탭 안내 문구를 렌더링하지 않는다', () => {
  const images = [
    renderUsageSummary(snapshot(), 0).image,
    renderUsageSummary(snapshot(), 1).image,
    renderSessionUsage(snapshot(), 0).image
  ].map(decode);
  for (const svg of images) {
    assert.doesNotMatch(svg, /AZURE EST|TAP NEXT|TAP MONTH|TAP TODAY/);
    assert.match(svg, /font-size="34"/);
    assert.match(svg, /font-size="18"/);
  }
});
