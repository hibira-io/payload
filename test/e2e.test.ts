// A real Payload (SQLite) against a Hibira-compatible server. Runs when
// HIBIRA_E2E_APP_ID, HIBIRA_E2E_KEY, HIBIRA_E2E_SECRET and HIBIRA_E2E_HOST
// are set (HIBIRA_E2E_PORT, HIBIRA_E2E_TLS=false for a local server).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PusherJS from 'pusher-js';
import { buildConfig, getPayload } from 'payload';
import { sqliteAdapter } from '@payloadcms/db-sqlite';
import { hibiraPlugin, type ChangeEvent } from '../src/index.js';
import { subscribe } from '../src/client.js';

const env = process.env;
const on = Boolean(env.HIBIRA_E2E_APP_ID && env.HIBIRA_E2E_KEY && env.HIBIRA_E2E_SECRET && env.HIBIRA_E2E_HOST);
const tls = env.HIBIRA_E2E_TLS !== 'false';
const port = Number(env.HIBIRA_E2E_PORT || (tls ? 443 : 80));
const dir = mkdtempSync(join(tmpdir(), 'hibira-payload-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!on)('with Payload and Hibira', () => {
  it('delivers create, publish, update, delete and global events to a browser client', async () => {
    const config = await buildConfig({
      secret: 'test-secret-0123456789',
      db: sqliteAdapter({ client: { url: `file:${join(dir, 'db.sqlite')}` } }),
      collections: [
        { slug: 'posts', fields: [{ name: 'title', type: 'text' }] },
        { slug: 'pages', versions: { drafts: true }, fields: [{ name: 'title', type: 'text' }] },
      ],
      globals: [{ slug: 'header', fields: [{ name: 'nav', type: 'text' }] }],
      plugins: [
        hibiraPlugin({
          appId: env.HIBIRA_E2E_APP_ID,
          key: env.HIBIRA_E2E_KEY,
          secret: env.HIBIRA_E2E_SECRET,
          host: env.HIBIRA_E2E_HOST,
          port,
          useTLS: tls,
          collections: { posts: { fields: ['title'] }, pages: true },
          globals: { header: true },
        }),
      ],
    });
    const payload = await getPayload({ config });

    const pusher = new PusherJS(env.HIBIRA_E2E_KEY!, {
      cluster: 'hkg',
      wsHost: env.HIBIRA_E2E_HOST,
      wsPort: port,
      wssPort: port,
      forceTLS: tls,
      enabledTransports: ['ws', 'wss'],
    });
    const got: ChangeEvent[] = [];
    const ready = (name: string) => new Promise<void>((r) => pusher.subscribe(name).bind('pusher:subscription_succeeded', () => r()));
    subscribe(pusher, { collection: 'posts' }, (e) => got.push(e));
    subscribe(pusher, { collection: 'pages' }, (e) => got.push(e));
    subscribe(pusher, { global: 'header' }, (e) => got.push(e));
    await Promise.all(['payload-posts', 'payload-pages', 'payload-global-header'].map(ready));

    const post = await payload.create({ collection: 'posts', data: { title: 'Hello' } });
    await payload.update({ collection: 'posts', id: post.id, data: { title: 'Hello again' } });
    await payload.update({ collection: 'posts', id: post.id, data: { title: 'quiet' }, context: { hibira: false } });
    const page = await payload.create({ collection: 'pages', data: { title: 'Draft' }, draft: true });
    await payload.update({ collection: 'pages', id: page.id, data: { title: 'Live', _status: 'published' } });
    await payload.delete({ collection: 'posts', id: post.id });
    await payload.updateGlobal({ slug: 'header', data: { nav: 'Home' } });

    await new Promise((r) => setTimeout(r, 1500));
    pusher.disconnect();
    await payload.destroy();

    const summary = got.map((e) => [e.collection ?? 'global:' + e.global, e.operation, e.doc?.title ?? e.status ?? '']);
    expect(summary).toEqual([
      ['posts', 'create', 'Hello'],
      ['posts', 'update', 'Hello again'],
      ['pages', 'update', 'published'],
      ['posts', 'delete', ''],
      ['global:header', 'update', ''],
    ]);
  }, 60000);
});
