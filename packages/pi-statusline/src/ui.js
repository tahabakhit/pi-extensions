import { stripVTControlCharacters } from 'node:util';

// Values can originate in Git, model catalogs or extension statuses. Never let
// embedded control sequences turn display metadata into terminal instructions.
export function plain(value) {
  return stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
}

export function directory(cwd, home) {
  const path = plain(cwd);
  return home && (path === home || path.startsWith(home + '/')) ? '~' + path.slice(home.length) : path;
}

export function tokens(value) {
  if (!Number.isFinite(value) || value < 0) return '?';
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  return value >= 1000 ? `${+(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

export function contextSegment(usage, model) {
  const percent = usage?.percent;
  const known = Number.isFinite(percent) && percent >= 0;
  const value = known ? Math.min(100, percent) : null;
  const window = usage?.contextWindow ?? model?.contextWindow;
  const count = Number.isFinite(usage?.tokens) && Number.isFinite(window) && window > 0
    ? ` (${tokens(usage.tokens)}/${tokens(window)})` : '';
  return {
    text: `Context ${value === null ? '?' : Math.round(value) + '%'} used${count}`,
    color: value === null ? 'muted' : value >= 90 ? 'error' : value >= 80 ? 'warning' : 'success',
  };
}

export function speed(value) {
  if (!Number.isFinite(value) || value < 0) return '?';
  return value >= 999.95 ? `${(value / 1000).toFixed(1)}k t/s` : `${value.toFixed(1)} t/s`;
}

// Generation speed: output tokens from the first streamed chunk to message end.
// Only replies measured in this process count; resumed history carries no timing.
const UNMEASURED = new Set(['error', 'aborted']);
const MIN_DURATION_MS = 250;
export function createSpeedTracker(now = Date.now) {
  let pending, last, output = 0, duration = 0;
  return {
    start() { pending = { first: null }; },
    chunk() { if (pending && pending.first === null) pending.first = now(); },
    finish(message) {
      const reply = pending;
      pending = undefined;
      if (!reply || reply.first === null) return;
      const ms = now() - reply.first;
      const tokens = message?.usage?.output;
      if (UNMEASURED.has(message?.stopReason) || !Number.isFinite(tokens) || tokens <= 0
        || !(ms >= MIN_DURATION_MS)) return;
      last = tokens / (ms / 1000);
      output += tokens;
      duration += ms;
    },
    reset() { pending = last = undefined; output = duration = 0; },
    stats() { return last === undefined ? null : { last, average: output / (duration / 1000) }; },
  };
}

export function speedSegment(stats) {
  if (!stats) return null;
  return { text: `Out ${speed(stats.last)} · avg ${speed(stats.average)}`, color: 'muted' };
}

// Transcript stamps: a dim right-aligned row with the local time after each user
// message, and the finish time plus elapsed time since that message after each
// final reply. Custom entries persist in the session but never reach the model.
export const STAMP_TYPE = 'statusline-stamp';
// Rows written by the retired pi-stamp package keep rendering (time only).
export const LEGACY_STAMP_TYPE = 'pi-stamp';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const validTime = value => Number.isFinite(value) && value > 0;
const pad = value => String(value).padStart(2, '0');

// 24-hour local time; the date appears when the day differs from the previous stamp.
export function clock(at, previous) {
  if (!validTime(at)) return '';
  const date = new Date(at);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const before = validTime(previous) ? new Date(previous) : null;
  const sameDay = before && before.getFullYear() === date.getFullYear()
    && before.getMonth() === date.getMonth() && before.getDate() === date.getDate();
  return sameDay ? time : `${MONTHS[date.getMonth()]} ${date.getDate()} ${time}`;
}

export function elapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function stampText(data) {
  const time = clock(data?.at ?? data?.timestamp, data?.previous ?? data?.previousTimestamp);
  if (!time) return '';
  const took = data?.role === 'assistant' ? elapsed(data.took) : '';
  return took ? `${time} · ${took}` : time;
}

export function stampComponent(text, theme, { truncateToWidth, visibleWidth }) {
  return {
    render(width) {
      if (!text || width <= 0) return [];
      const line = truncateToWidth(theme.fg('dim', text), width);
      return [' '.repeat(Math.max(0, width - visibleWidth(line))) + line];
    },
    invalidate() {},
  };
}

// Latest stamp time on the active branch, so a resumed session keeps date context.
function lastStampTime(ctx) {
  const branch = ctx.sessionManager?.getBranch?.() ?? [];
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type !== 'custom') continue;
    if (entry.customType !== STAMP_TYPE && entry.customType !== LEGACY_STAMP_TYPE) continue;
    const at = entry.data?.at ?? entry.data?.completedAt ?? entry.data?.timestamp;
    if (validTime(at)) return at;
  }
  return undefined;
}

export function renderFooter(ctx, data, theme, width, { truncateToWidth, visibleWidth, home }, speedStats) {
  if (width <= 0) return [];
  const paint = (color, text) => theme.fg(color, text);
  const dot = paint('dim', ' · ');
  let cwd = directory(ctx.cwd, home);
  const branch = plain(data.getGitBranch());
  const model = plain(ctx.model?.id) || 'no model';
  const effort = plain(ctx.thinkingLevel);
  const modelText = paint('accent', model + (effort && effort !== 'off' ? ` ${effort}` : ''));
  // Abbreviate the directory first; don't let a deep path crowd out the model.
  if (visibleWidth(cwd) > Math.max(12, width / 3)) {
    const parts = cwd.split('/');
    cwd = (cwd.startsWith('~/') ? '~/…/' : '…/') + parts.at(-1);
  }
  let identity = [paint('borderAccent', cwd), branch && paint('mdCode', branch), modelText].filter(Boolean);
  if (visibleWidth(identity.join(dot)) > width && branch) identity.splice(1, 1);
  if (visibleWidth(identity.join(dot)) > width) identity = [modelText];
  const context = contextSegment(ctx.getContextUsage(), ctx.model);
  let usage = paint(context.color, context.text);
  const rate = speedSegment(speedStats);
  // Speed is secondary: drop it before truncating the context figure.
  if (rate && visibleWidth(context.text + ' · ' + rate.text) <= width) usage += dot + paint(rate.color, rate.text);
  const lines = [identity.join(dot), usage];
  // Keep statuses visible without confusing them with our context/account data.
  const statuses = [...data.getExtensionStatuses().values()].map(plain).filter(Boolean);
  if (statuses.length) lines.push(paint('muted', statuses.join(' · ')));
  return lines.map(line => truncateToWidth(line, width));
}

// Inject host classes/helpers so lifecycle and layout tests need no installed Pi.
export function installUI(pi, host) {
  let current;
  let requestRender;
  let disposeBranch;
  const speedTracker = createSpeedTracker(host.now);
  const now = host.now ?? Date.now;
  const renderStamp = (entry, _options, theme) => {
    const text = stampText(entry?.data);
    return text ? stampComponent(text, theme, host) : undefined;
  };
  pi.registerEntryRenderer?.(STAMP_TYPE, renderStamp);
  pi.registerEntryRenderer?.(LEGACY_STAMP_TYPE, renderStamp);
  // Stamps are TUI-only, so RPC children (subagents) and print runs write none.
  let stamping = false, pendingUsers = [], userAt, lastAt;
  const appendStamp = data => {
    pi.appendEntry(STAMP_TYPE, { version: 1, ...data, ...(validTime(lastAt) ? { previous: lastAt } : {}) });
    lastAt = data.at;
  };
  // Pi persists a user message after its message_end hook, so its stamp waits
  // for the next message or the end of the run to land after it.
  const flushUsers = () => {
    if (stamping) for (const at of pendingUsers) appendStamp({ role: 'user', at });
    pendingUsers = [];
  };
  const dispose = () => {
    speedTracker.reset();
    disposeBranch?.();
    disposeBranch = undefined;
    requestRender = undefined;
    current = undefined;
  };
  const refresh = (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    current = ctx;
    requestRender?.();
  };

  pi.on('session_start', (_event, ctx) => {
    dispose();
    stamping = ctx.mode === 'tui';
    pendingUsers = [];
    userAt = undefined;
    lastAt = stamping ? lastStampTime(ctx) : undefined;
    if (ctx.mode !== 'tui') return;
    current = ctx;
    // Native CustomEditor preserves completion, paste, IME, selection and app
    // shortcuts. Pi owns the working animation, including retries/compaction.
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new host.CustomEditor(tui, theme, keybindings, { paddingX: 1, embedWorkingStatus: true }));
    ctx.ui.setHeader((_tui, theme) => ({
      render(width) {
        if (!current || width <= 0) return [];
        const name = plain(current.sessionManager.getSessionName());
        return [host.truncateToWidth(theme.fg('accent', 'Pi') + theme.fg('dim', ' · ')
          + theme.fg('muted', name || 'workspace'), width)];
      },
      invalidate() {},
    }));
    ctx.ui.setFooter((tui, theme, data) => {
      disposeBranch?.();
      requestRender = () => tui.requestRender();
      const unsubscribe = data.onBranchChange(requestRender);
      let disposed = false;
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        if (disposeBranch === cleanup) {
          disposeBranch = undefined;
          requestRender = undefined;
        }
      };
      disposeBranch = cleanup;
      return {
        render: width => current ? renderFooter(current, data, theme, width, host, speedTracker.stats()) : [],
        invalidate() {},
        dispose: cleanup,
      };
    });
  });
  for (const event of ['model_select', 'thinking_level_select', 'session_compact',
    'session_tree', 'session_info_changed', 'agent_start', 'agent_settled']) pi.on(event, refresh);
  // Start/end fire for every role. Handlers return nothing: a message_end return
  // value would replace the message. Chunks only stamp time; they never redraw.
  pi.on('message_start', (event, ctx) => {
    flushUsers();
    if (ctx.mode === 'tui' && event?.message?.role === 'assistant') speedTracker.start();
  });
  pi.on('message_update', () => { speedTracker.chunk(); });
  pi.on('message_end', (event, ctx) => {
    const message = event?.message;
    if (ctx.mode === 'tui' && message?.role === 'assistant') speedTracker.finish(message);
    if (stamping && message?.role === 'user' && validTime(message.timestamp)) {
      pendingUsers.push(message.timestamp);
      userAt = message.timestamp;
    }
    refresh(event, ctx);
  });
  // A final reply (anything but a tool call) gets the finish time and the time
  // since the user's message; intermediate tool turns stay unstamped.
  pi.on('turn_end', event => {
    const message = event?.message;
    if (!stamping || message?.role !== 'assistant' || message.stopReason === 'toolUse') return;
    flushUsers();
    const at = now();
    appendStamp({ role: 'assistant', at, ...(validTime(userAt) && at >= userAt ? { took: at - userAt } : {}) });
    userAt = undefined;
  });
  pi.on('agent_end', () => { flushUsers(); });
  pi.on('session_shutdown', () => {
    flushUsers();
    stamping = false;
    dispose();
  });
}
