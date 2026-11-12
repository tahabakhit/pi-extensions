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

export function installTimestamps(pi, host) {
  const now = host.now ?? Date.now;
  const renderStamp = (entry, _options, theme) => {
    const text = stampText(entry?.data);
    return text ? stampComponent(text, theme, host) : undefined;
  };
  pi.registerEntryRenderer(STAMP_TYPE, renderStamp);
  pi.registerEntryRenderer(LEGACY_STAMP_TYPE, renderStamp);
  let stamping = false, pendingUsers = [], userAt, lastAt;
  const appendStamp = data => {
    pi.appendEntry(STAMP_TYPE, { version: 1, ...data, ...(validTime(lastAt) ? { previous: lastAt } : {}) });
    lastAt = data.at;
  };
  // message_end precedes persistence, so queue the user stamp until the next message.
  const flushUsers = () => {
    if (stamping) for (const at of pendingUsers) appendStamp({ role: 'user', at });
    pendingUsers = [];
  };
  pi.on('session_start', (_event, ctx) => {
    stamping = ctx.mode === 'tui';
    pendingUsers = [];
    userAt = undefined;
    lastAt = stamping ? lastStampTime(ctx) : undefined;
  });
  pi.on('message_start', flushUsers);
  pi.on('message_end', (event, ctx) => {
    const message = event?.message;
    if (stamping && ctx.mode === 'tui' && message?.role === 'user' && validTime(message.timestamp)) {
      pendingUsers.push(message.timestamp);
      userAt = message.timestamp;
    }
  });
  pi.on('turn_end', event => {
    const message = event?.message;
    if (!stamping || message?.role !== 'assistant' || message.stopReason === 'toolUse') return;
    flushUsers();
    const at = now();
    appendStamp({ role: 'assistant', at, ...(validTime(userAt) && at >= userAt ? { took: at - userAt } : {}) });
    userAt = undefined;
  });
  pi.on('agent_end', flushUsers);
  pi.on('session_shutdown', () => {
    flushUsers();
    stamping = false;
  });
}
