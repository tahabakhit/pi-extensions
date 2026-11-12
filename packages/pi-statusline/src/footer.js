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

export function renderFooter(ctx, data, theme, width, { truncateToWidth, visibleWidth, home }) {
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
  const usage = paint(context.color, context.text);
  const lines = [identity.join(dot), usage];
  // Keep statuses visible without confusing them with our context/account data.
  const statuses = [...data.getExtensionStatuses().values()].map(plain).filter(Boolean);
  if (statuses.length) lines.push(paint('muted', statuses.join(' · ')));
  return lines.map(line => truncateToWidth(line, width));
}

// Host helpers are injected so layout and lifecycle tests need no installed Pi.
export function installFooter(pi, host) {
  let current, requestRender, disposeBranch;
  const dispose = () => {
    disposeBranch?.();
    disposeBranch = requestRender = current = undefined;
  };
  const refresh = (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    current = ctx;
    requestRender?.();
  };
  pi.on('session_start', (_event, ctx) => {
    dispose();
    if (ctx.mode !== 'tui') return;
    current = ctx;
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
          disposeBranch = requestRender = undefined;
        }
      };
      disposeBranch = cleanup;
      return {
        render: width => current ? renderFooter(current, data, theme, width, host) : [],
        invalidate() {},
        dispose: cleanup,
      };
    });
  });
  for (const event of ['model_select', 'thinking_level_select', 'session_compact',
    'session_tree', 'agent_start', 'agent_settled', 'message_end']) pi.on(event, refresh);
  pi.on('session_shutdown', dispose);
}
