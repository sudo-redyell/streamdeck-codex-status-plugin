#!/usr/bin/env node

'use strict';

const { renderSessionUsage, renderStatus, renderUsageSummary } = require('./lib/render');
const { CodexStatusMonitor } = require('./lib/status');
const { TokenUsageMonitor } = require('./lib/usage');

const WebSocketClient = globalThis.WebSocket || require('ws');
const POLL_INTERVAL_MS = 1000;

const ACTIONS = new Map([
  ['io.github.streamdeck-codex-status.monitor', { kind: 'status', theme: 'light' }],
  ['io.github.streamdeck-codex-status.monitor-dark', { kind: 'status', theme: 'dark' }],
  ['io.github.streamdeck-codex-status.usage', { kind: 'summary', theme: 'light' }],
  ['io.github.streamdeck-codex-status.usage-dark', { kind: 'summary', theme: 'dark' }],
  ['io.github.streamdeck-codex-status.sessions', { kind: 'sessions', theme: 'light' }],
  ['io.github.streamdeck-codex-status.sessions-dark', { kind: 'sessions', theme: 'dark' }]
]);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-port') values.port = argv[index + 1];
    if (argument === '-pluginUUID') values.pluginUUID = argv[index + 1];
    if (argument === '-registerEvent') values.registerEvent = argv[index + 1];
  }
  return values;
}

function start() {
  const { port, pluginUUID, registerEvent } = parseArgs(process.argv.slice(2));
  if (!port || !pluginUUID || !registerEvent) {
    console.error('[Codex Status] OpenDeck 시작 인자가 없습니다.');
    process.exit(1);
  }

  const statusMonitor = new CodexStatusMonitor();
  const usageMonitor = new TokenUsageMonitor();
  const statusContexts = new Map();
  const summaryContexts = new Map();
  const sessionContexts = new Map();
  const viewIndices = new Map();
  const lastImages = new Map();
  const socket = new WebSocketClient(`ws://127.0.0.1:${port}`);
  let statusPolling = false;
  let usagePolling = false;
  let latestUsage = null;
  let timer = null;

  const send = (message) => {
    if (socket.readyState !== WebSocketClient.OPEN) return;
    socket.send(JSON.stringify(message));
  };

  const setImage = (context, image) => {
    if (lastImages.get(context) === image) return;
    send({ event: 'setImage', context, payload: { image, target: 0 } });
    lastImages.set(context, image);
  };

  const refreshStatus = async () => {
    if (statusPolling || statusContexts.size === 0) return;
    statusPolling = true;
    try {
      const status = await statusMonitor.getStatus();
      for (const [context, theme] of statusContexts) {
        setImage(context, renderStatus(status, theme));
      }
    } catch (error) {
      console.warn('[Codex Status] 상태 갱신 실패:', error.message);
    } finally {
      statusPolling = false;
    }
  };

  const paintUsage = () => {
    if (!latestUsage) return;

    for (const [context, theme] of summaryContexts) {
      const rendered = renderUsageSummary(latestUsage, viewIndices.get(context) || 0, theme);
      viewIndices.set(context, rendered.viewIndex);
      setImage(context, rendered.image);
    }
    for (const [context, theme] of sessionContexts) {
      const rendered = renderSessionUsage(latestUsage, viewIndices.get(context) || 0, theme);
      viewIndices.set(context, rendered.viewIndex);
      setImage(context, rendered.image);
    }
  };

  const refreshUsage = async () => {
    if (usagePolling || (summaryContexts.size === 0 && sessionContexts.size === 0)) return;
    usagePolling = true;
    try {
      latestUsage = await usageMonitor.getSnapshot();
      paintUsage();
    } catch (error) {
      console.warn('[Codex Status] 토큰 갱신 실패:', error.message);
    } finally {
      usagePolling = false;
    }
  };

  const startPolling = () => {
    if (timer) return;
    void refreshStatus();
    void refreshUsage();
    timer = setInterval(() => {
      void refreshStatus();
      void refreshUsage();
    }, POLL_INTERVAL_MS);
  };

  const stopPollingIfIdle = () => {
    if (statusContexts.size > 0 || summaryContexts.size > 0 || sessionContexts.size > 0 || !timer) return;
    clearInterval(timer);
    timer = null;
  };

  socket.addEventListener('open', () => {
    send({ event: registerEvent, uuid: pluginUUID });
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch (error) {
      console.warn('[Codex Status] OpenDeck 메시지 파싱 실패:', error.message);
      return;
    }

    const action = ACTIONS.get(message.action);
    if (!action) return;

    if (message.event === 'willAppear') {
      lastImages.delete(message.context);
      if (action.kind === 'status') statusContexts.set(message.context, action.theme);
      if (action.kind === 'summary') summaryContexts.set(message.context, action.theme);
      if (action.kind === 'sessions') sessionContexts.set(message.context, action.theme);
      viewIndices.set(message.context, 0);
      startPolling();
      return;
    }

    if (message.event === 'willDisappear') {
      statusContexts.delete(message.context);
      summaryContexts.delete(message.context);
      sessionContexts.delete(message.context);
      viewIndices.delete(message.context);
      lastImages.delete(message.context);
      stopPollingIfIdle();
      return;
    }

    if (message.event !== 'keyDown') return;

    if (action.kind === 'status') {
      lastImages.delete(message.context);
      void refreshStatus();
      return;
    }

    const current = viewIndices.get(message.context) || 0;
    const viewCount = action.kind === 'summary'
      ? 2
      : Math.max(1, latestUsage?.sessions.length || 0);
    viewIndices.set(message.context, (current + 1) % viewCount);
    lastImages.delete(message.context);
    paintUsage();
    void refreshUsage();
  });

  socket.addEventListener('error', (event) => {
    console.warn('[Codex Status]', event.message || 'WebSocket 연결 오류');
  });
  socket.addEventListener('close', () => {
    if (timer) clearInterval(timer);
    process.exit(0);
  });

  const shutdown = () => {
    if (timer) clearInterval(timer);
    socket.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) start();

module.exports = { ACTIONS, parseArgs, start };
