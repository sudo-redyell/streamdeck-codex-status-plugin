'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { calculateCost, getPricingOptions } = require('./pricing');
const { findLiveCodexSessions } = require('./status');

const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;
const BACKGROUND_REFRESH_MS = 30_000;

function emptyUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  };
}

function addUsage(left, right) {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens
  };
}

function subtractUsage(current, previous) {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    cacheWriteInputTokens: Math.max(0, current.cacheWriteInputTokens - previous.cacheWriteInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens)
  };
}

function fromLog(value) {
  const number = (key) => {
    const candidate = value?.[key];
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.max(0, candidate)
      : 0;
  };
  const usage = {
    inputTokens: number('input_tokens'),
    cachedInputTokens: number('cached_input_tokens'),
    cacheWriteInputTokens: number('cache_write_input_tokens'),
    outputTokens: number('output_tokens'),
    reasoningOutputTokens: number('reasoning_output_tokens'),
    totalTokens: number('total_tokens')
  };
  if (usage.totalTokens === 0) usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return usage;
}

function sameUsage(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function isReset(current, previous) {
  return current.totalTokens < previous.totalTokens ||
    current.inputTokens < previous.inputTokens ||
    current.outputTokens < previous.outputTokens;
}

function tokenDelta(current, previous, last) {
  if (!previous) return current;
  if (sameUsage(current, previous)) return emptyUsage();
  return isReset(current, previous) ? last : subtractUsage(current, previous);
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localMonthKey(value) {
  return localDateKey(value)?.slice(0, 7) || null;
}

function addDailyBucket(entry, date, model, usage) {
  const day = entry.dailyBuckets.get(date) || new Map();
  const current = day.get(model) || emptyUsage();
  day.set(model, addUsage(current, usage));
  entry.dailyBuckets.set(date, day);
}

function createEntry(filePath, stat) {
  return {
    currentModel: 'unknown',
    dailyBuckets: new Map(),
    device: stat.dev,
    filePath,
    inode: stat.ino,
    offset: 0,
    previousTotal: undefined,
    remainder: '',
    sessionId: path.basename(filePath, '.jsonl').replace(/^rollout-/, ''),
    sessionName: '',
    skipped: false,
    updatedAt: stat.mtime.toISOString()
  };
}

class SessionUsageTracker {
  constructor(options = {}) {
    this.fileSystem = options.fileSystem || fs;
    this.maxFileBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
    this.entries = new Map();
  }

  async refresh(filePath) {
    let stat;
    try {
      stat = await this.fileSystem.stat(filePath);
    } catch {
      // 이미 집계한 삭제 파일의 월간 값은 메모리에 유지합니다.
      return this.entries.get(filePath);
    }

    let entry = this.entries.get(filePath);
    if (!entry || stat.size < entry.offset || stat.dev !== entry.device || stat.ino !== entry.inode) {
      entry = createEntry(filePath, stat);
      this.entries.set(filePath, entry);
    }

    if (stat.size > this.maxFileBytes) {
      entry.skipped = true;
      return entry;
    }
    entry.skipped = false;
    if (stat.size <= entry.offset) return entry;

    let handle;
    try {
      handle = await this.fileSystem.open(filePath, 'r');
      const chunks = [];
      while (entry.offset < stat.size) {
        const length = Math.min(stat.size - entry.offset, 64 * 1024);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, entry.offset);
        if (bytesRead === 0) break;
        entry.offset += bytesRead;
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const consumedTimestamp = this.#consume(entry, Buffer.concat(chunks).toString('utf8'));
      // 로그 이벤트가 시각을 제공하지 않을 때만 파일 수정 시각을 보조값으로 사용합니다.
      if (!consumedTimestamp) entry.updatedAt = stat.mtime.toISOString();
    } catch {
      return entry;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // rollout을 소유한 프로세스가 먼저 종료될 수 있습니다.
        }
      }
    }
    return entry;
  }

  clear() {
    this.entries.clear();
  }

  #consume(entry, text) {
    const lines = `${entry.remainder}${text}`.split('\n');
    entry.remainder = lines.pop() || '';
    let consumedTimestamp = false;

    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = record.payload || {};
      if (record.timestamp && Number.isFinite(new Date(record.timestamp).getTime())) {
        entry.updatedAt = record.timestamp;
        consumedTimestamp = true;
      }

      if (record.type === 'session_meta') {
        entry.sessionId = String(payload.id || payload.session_id || entry.sessionId).replace(/^rollout-/, '');
        if (typeof payload.cwd === 'string' && payload.cwd) {
          entry.sessionName = path.basename(payload.cwd) || payload.cwd;
        }
      }
      if (record.type === 'turn_context' && typeof payload.model === 'string' && payload.model) {
        entry.currentModel = payload.model;
      }
      if (record.type !== 'event_msg' || payload.type !== 'token_count' || !payload.info) continue;

      const current = fromLog(payload.info.total_token_usage || payload.info.last_token_usage);
      const last = fromLog(payload.info.last_token_usage || payload.info.total_token_usage);
      const delta = tokenDelta(current, entry.previousTotal, last);
      entry.previousTotal = current;
      if (delta.totalTokens === 0 && delta.inputTokens === 0 && delta.outputTokens === 0) continue;

      const date = localDateKey(record.timestamp || entry.updatedAt);
      if (date) addDailyBucket(entry, date, entry.currentModel, delta);
    }
    return consumedTimestamp;
  }
}

async function walkJsonl(fileSystem, directory) {
  let entries;
  try {
    entries = await fileSystem.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJsonl(fileSystem, target);
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [target] : [];
  }));
  return nested.flat();
}

function summarizeBuckets(entries, datePredicate, pricing) {
  let usage = emptyUsage();
  let totalKrw = 0;
  let fallbackPriced = false;
  const sessionIds = new Set();

  for (const entry of entries) {
    let sessionHasUsage = false;
    for (const [date, buckets] of entry.dailyBuckets) {
      if (!datePredicate(date)) continue;
      for (const [model, bucketUsage] of buckets) {
        usage = addUsage(usage, bucketUsage);
        const cost = calculateCost(bucketUsage, model, pricing);
        totalKrw += cost.totalKrw;
        fallbackPriced ||= cost.estimatedFromFallback;
        sessionHasUsage = true;
      }
    }
    if (sessionHasUsage) sessionIds.add(entry.sessionId);
  }

  return { fallbackPriced, sessionCount: sessionIds.size, totalKrw, usage };
}

function summarizeSession(entry, date, pricing) {
  const buckets = entry.dailyBuckets.get(date);
  if (!buckets) return null;
  let usage = emptyUsage();
  let totalKrw = 0;
  let fallbackPriced = false;
  for (const [model, bucketUsage] of buckets) {
    usage = addUsage(usage, bucketUsage);
    const cost = calculateCost(bucketUsage, model, pricing);
    totalKrw += cost.totalKrw;
    fallbackPriced ||= cost.estimatedFromFallback;
  }
  if (usage.totalTokens === 0 && usage.inputTokens === 0 && usage.outputTokens === 0) return null;
  return {
    fallbackPriced,
    id: entry.sessionId,
    name: entry.sessionName || `session-${entry.sessionId.slice(0, 6)}`,
    totalKrw,
    updatedAt: entry.updatedAt,
    usage
  };
}

class TokenUsageMonitor {
  constructor(options = {}) {
    this.fileSystem = options.fileSystem || fs;
    this.codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.procRoot = options.procRoot || '/proc';
    this.now = options.now || (() => new Date());
    this.pricing = options.pricing || getPricingOptions(options.environment);
    this.liveSessionFinder = options.liveSessionFinder || ((procRoot, fileSystem) =>
      findLiveCodexSessions(procRoot, fileSystem));
    const configuredLimit = Number(options.maxFileBytes || process.env.CODEX_STATUS_MAX_FILE_BYTES);
    this.tracker = options.tracker || new SessionUsageTracker({
      fileSystem: this.fileSystem,
      maxFileBytes: Number.isFinite(configuredLimit) && configuredLimit > 0
        ? configuredLimit
        : DEFAULT_MAX_FILE_BYTES
    });
    this.initialized = false;
    this.knownPaths = new Set();
    this.lastBackgroundRefresh = 0;
    this.monthKey = null;
  }

  async getSnapshot() {
    const now = this.now();
    const today = localDateKey(now);
    const month = localMonthKey(now);
    if (!today || !month) throw new Error('현재 날짜를 계산할 수 없습니다.');

    if (this.monthKey !== month) {
      this.monthKey = month;
      this.initialized = false;
      this.knownPaths.clear();
      this.tracker.clear();
    }

    const refreshPaths = new Set();
    if (!this.initialized) {
      const allFiles = await walkJsonl(this.fileSystem, path.join(this.codexHome, 'sessions'));
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      await Promise.all(allFiles.map(async (filePath) => {
        try {
          const stat = await this.fileSystem.stat(filePath);
          if (stat.mtimeMs >= monthStart) refreshPaths.add(filePath);
        } catch {
          // 초기 탐색 중 사라진 파일은 다음 주기에 다시 발견할 수 있습니다.
        }
      }));
      this.initialized = true;
    }

    const dayDirectory = path.join(
      this.codexHome,
      'sessions',
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    );
    for (const filePath of await walkJsonl(this.fileSystem, dayDirectory)) refreshPaths.add(filePath);

    try {
      const live = await this.liveSessionFinder(this.procRoot, this.fileSystem);
      for (const filePath of live.sessionPaths || []) refreshPaths.add(filePath);
    } catch {
      // 토큰 집계는 /proc 탐색 실패와 독립적으로 오늘 파일을 계속 읽습니다.
    }

    const nowMs = now.getTime();
    if (nowMs - this.lastBackgroundRefresh >= BACKGROUND_REFRESH_MS) {
      for (const filePath of this.knownPaths) refreshPaths.add(filePath);
      this.lastBackgroundRefresh = nowMs;
    }
    for (const filePath of refreshPaths) this.knownPaths.add(filePath);

    const paths = [...refreshPaths];
    let next = 0;
    const worker = async () => {
      while (next < paths.length) {
        const filePath = paths[next++];
        await this.tracker.refresh(filePath);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, paths.length) }, worker));

    const entries = [...this.tracker.entries.values()].filter((entry) => !entry.skipped);
    const monthly = summarizeBuckets(entries, (date) => date.startsWith(`${month}-`), this.pricing);
    const daily = summarizeBuckets(entries, (date) => date === today, this.pricing);
    const sessions = entries
      .map((entry) => summarizeSession(entry, today, this.pricing))
      .filter(Boolean)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return {
      daily,
      generatedAt: now.toISOString(),
      month,
      monthly,
      pricing: this.pricing,
      sessions,
      skippedFiles: [...this.tracker.entries.values()].filter((entry) => entry.skipped).length,
      today
    };
  }
}

module.exports = {
  SessionUsageTracker,
  TokenUsageMonitor,
  addUsage,
  emptyUsage,
  fromLog,
  localDateKey,
  localMonthKey,
  summarizeBuckets,
  summarizeSession,
  tokenDelta,
  walkJsonl
};
