// The design-system import's routes (server/design/import/, http/routes/design-import.ts) for the client's page.

import type { ImportScanView, ImportSummary } from '../../../../shared/design/import/types';
import type { TokenOverrides } from '../../../../shared/design/tokens';

export type ImportedView = ImportSummary & { tokens?: TokenOverrides };

async function post<T>(body: Record<string, unknown>): Promise<{ out?: T; error?: string }> {
  try {
    const res = await fetch('/api/design/import', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { out } : { error: out.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export const importApi = {
  scan: (client: string, path: string) => post<ImportScanView>({ action: 'scan', client, path }),
  save: (client: string, body: Record<string, unknown>) => post<{ ok: true; overrides: number }>({ action: 'save', client, ...body }),
  async summary(client: string): Promise<ImportedView | undefined> {
    try {
      const res = await fetch(`/api/design/import?client=${encodeURIComponent(client)}`, { credentials: 'same-origin' });
      const out = (await res.json().catch(() => ({}))) as {
        imported?: ImportedView | null;
      };
      return out.imported ?? undefined;
    } catch {
      return undefined;
    }
  },
};
