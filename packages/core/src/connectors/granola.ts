import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Connector, ConnectorSyncResult, ConnectorStatus } from './types.js';
import { resolveConnectorTarget } from './paths.js';

export interface GranolaMeeting {
  id: string;
  title: string;
  started_at: string; // ISO timestamp
  ended_at?: string;
  attendees?: string[];
  summary?: string;
  transcript?: string;
  tags?: string[];
}

export interface GranolaConnectorOptions {
  name?: string;
  target?: string;
  /** Inject your own meeting fetcher — preferred when you have Granola SDK / MCP wired. */
  fetchMeetings?: (since?: string) => Promise<GranolaMeeting[]>;
  /** HTTPS endpoint that returns Granola meetings as JSON. */
  apiUrl?: string;
  /** Bearer token sent as Authorization header. */
  apiKey?: string;
  /** ISO date — only fetch meetings since this point. Defaults to "all". */
  since?: string;
  /** Frontmatter tag to add to every imported meeting page. */
  tag?: string;
  /** Include the full transcript in the markdown body. Default false (summary only). */
  includeTranscript?: boolean;
}

export function createGranolaConnector(opts: GranolaConnectorOptions = {}): Connector {
  const name = opts.name ?? 'granola';
  const target = opts.target?.trim() || `external/${name}`;
  let lastSync: string | null = null;
  let lastResult: ConnectorSyncResult | null = null;
  let lastError: string | null = null;
  let configured = true;

  if (!opts.fetchMeetings && !opts.apiUrl) {
    configured = false;
    lastError = 'GranolaConnector requires either { fetchMeetings } (callback) or { apiUrl, apiKey }';
  }

  const fetcher = opts.fetchMeetings ?? (async (since?: string) => {
    if (!opts.apiUrl) return [];
    const url = new URL(opts.apiUrl);
    if (since) url.searchParams.set('since', since);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`Granola API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { meetings?: GranolaMeeting[] } | GranolaMeeting[];
    return Array.isArray(body) ? body : body.meetings ?? [];
  });

  return {
    name,
    kind: 'granola',
    target,
    async init() {
      if (!configured) return;
    },
    async sync(ctx) {
      const started = Date.now();
      if (!configured) {
        throw new Error(lastError ?? 'connector not configured');
      }

      const targetAbs = resolveConnectorTarget(ctx.contentRoot, target);
      await fs.mkdir(targetAbs, { recursive: true });

      const meetings = await fetcher(opts.since);
      let written = 0;
      let unchanged = 0;

      const seen = new Set<string>();
      for (const m of meetings) {
        const slug = slugify(m.title || m.id);
        // started_at may be absent/garbage from an upstream shape change — don't let
        // a `.slice` on undefined throw and abort the whole sync.
        const dateStr = typeof m.started_at === 'string' ? m.started_at.slice(0, 10) : 'undated';
        const filename = `${dateStr}-${slug}.md`;
        const dst = path.join(targetAbs, filename);
        seen.add(filename);

        const content = renderMeeting(m, { tag: opts.tag, includeTranscript: opts.includeTranscript });

        try {
          const existing = await fs.readFile(dst, 'utf8');
          if (existing === content) {
            unchanged++;
            continue;
          }
        } catch {
          /* missing */
        }
        await fs.writeFile(dst, content, 'utf8');
        written++;
      }

      // Cleanup orphans — but skip pruning entirely when (a) the fetch returned no
      // meetings (empty/failed upstream would otherwise wipe the whole mirror) or
      // (b) this is an incremental fetch (`since` narrows the window, so files
      // outside it are NOT orphans — reconciling would delete every older note).
      let deleted = 0;
      const incremental = Boolean(opts.since);
      if (meetings.length > 0 && !incremental) {
        try {
          const existing = await fs.readdir(targetAbs);
          for (const f of existing) {
            if (f.endsWith('.md') && !seen.has(f)) {
              await fs.unlink(path.join(targetAbs, f));
              deleted++;
            }
          }
        } catch {
          /* */
        }
      }

      lastResult = {
        files_written: written,
        files_unchanged: unchanged,
        files_deleted: deleted,
        duration_ms: Date.now() - started,
        notes: `synced ${meetings.length} meetings from Granola`,
      };
      lastSync = new Date().toISOString();
      lastError = null;
      ctx.events.emit('event', { type: 'connector.synced', connector: name, ...lastResult });
      return lastResult;
    },
    async stop() {
      /* no-op */
    },
    status(): ConnectorStatus {
      return {
        name,
        kind: 'granola',
        target,
        configured,
        last_sync_at: lastSync,
        last_result: lastResult,
        last_error: lastError,
      };
    },
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'meeting';
}

function renderMeeting(m: GranolaMeeting, opts: { tag?: string; includeTranscript?: boolean }): string {
  // Quote every interpolated value. Upstream fields are remote-controlled; an
  // unquoted id/timestamp/tag containing a newline or `:` used to inject arbitrary
  // YAML keys into the user's frontmatter.
  const q = (v: string): string => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
  const fm: string[] = [];
  fm.push(`title: ${q(m.title || m.id)}`);
  fm.push(`source: granola`);
  fm.push(`granola_id: ${q(m.id)}`);
  if (m.started_at) fm.push(`started_at: ${q(m.started_at)}`);
  if (m.ended_at) fm.push(`ended_at: ${q(m.ended_at)}`);
  if (m.attendees && m.attendees.length > 0) {
    fm.push(`attendees: [${m.attendees.map((a) => q(a)).join(', ')}]`);
  }
  const tags = new Set<string>(m.tags ?? []);
  tags.add('meeting');
  if (opts.tag) tags.add(opts.tag);
  fm.push(`tags: [${[...tags].map((t) => q(t)).join(', ')}]`);

  let body = `# ${m.title || m.id}\n\n`;
  if (m.summary) body += `## Summary\n\n${m.summary}\n\n`;
  if (m.attendees && m.attendees.length > 0) {
    body += `**Attendees:** ${m.attendees.join(', ')}\n\n`;
  }
  if (opts.includeTranscript && m.transcript) {
    body += `## Transcript\n\n${m.transcript}\n`;
  }
  return `---\n${fm.join('\n')}\n---\n\n${body}`;
}
