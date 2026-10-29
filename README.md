# @hibira-io/payload

[![npm](https://img.shields.io/npm/v/@hibira-io/payload)](https://www.npmjs.com/package/@hibira-io/payload)
[![ci](https://github.com/hibira-io/payload/actions/workflows/ci.yml/badge.svg)](https://github.com/hibira-io/payload/actions/workflows/ci.yml)

Live content for [Payload CMS](https://payloadcms.com) 3 on
[Hibira](https://hibira.io/?utm_source=github&utm_medium=readme&utm_campaign=plugins),
a hosted realtime service that speaks the Pusher Channels protocol. When
an editor publishes, updates or deletes something, every open page that
shows it refreshes by itself.

- A Payload plugin that sends a `change` event when watched collections and
  globals change, without blocking or failing the save.
- `<LiveRefresh>` for Next.js: re-renders the page's server components with
  `router.refresh()` when its content changes. Pages stay static or cached.
- `subscribe()` for any other frontend, on pusher-js.

Your server never holds a WebSocket open, so it works on Vercel and other
serverless hosts.

## Install

```sh
npm install @hibira-io/payload pusher-js
```

Create a free app at [hibira.io](https://hibira.io/portal) (no card), and
put its credentials in `.env`:

```sh
HIBIRA_APP_ID=
HIBIRA_APP_SECRET=
NEXT_PUBLIC_HIBIRA_APP_KEY=
# NEXT_PUBLIC_HIBIRA_HOST=ws.hibira.io
```

## Send events

```ts
// payload.config.ts
import { buildConfig } from 'payload';
import { hibiraPlugin } from '@hibira-io/payload';

export default buildConfig({
  // ...
  plugins: [
    hibiraPlugin({
      collections: {
        posts: true,
        products: { fields: ['price', 'stock'] },
      },
      globals: { header: true },
    }),
  ],
});
```

Each change goes to these channels:

| Channel | For |
|---|---|
| `payload-{collection}` | lists: any document in the collection |
| `payload-{collection}-{id}` | one document |
| `payload-global-{slug}` | a global |

The event is `change`:

```json
{ "collection": "products", "id": 12, "operation": "update", "updatedAt": "2026-10-29T08:00:00.000Z", "doc": { "price": 980, "stock": 3 } }
```

`operation` is `create`, `update` or `delete`. By default the event carries
no document fields; list the ones you want in `fields`. Channels are public,
so only list fields any visitor may see. Data larger than 10 KB is left out
and `truncated: true` is set.

With drafts on, events go out only when the published content changes:
publishing, or saving a published document. `drafts: 'all'` sends draft
saves too, for admin tools. Unpublishing is not reported.

Options:

| Option | Default | |
|---|---|---|
| `appId`, `key`, `secret` | `HIBIRA_APP_ID`, `HIBIRA_APP_KEY` or `NEXT_PUBLIC_HIBIRA_APP_KEY`, `HIBIRA_APP_SECRET` | credentials |
| `host`, `port`, `useTLS` | `ws.hibira.io`, 443, true | another cluster or a self-hosted server |
| `collections`, `globals` | none | `{ slug: true }` or `{ slug: { fields, drafts, channels } }` |
| `channels(doc)` | none | more channels per event, such as `author-${doc.author}` |
| `prefix` | `payload` | channel name prefix |
| `wait` | `true` | `false` sends in the background (may be cut off on serverless) |
| `enabled` | `true` | |

To skip events for one operation, such as an import:

```ts
await payload.update({ collection: 'posts', id, data, context: { hibira: false } });
```

If Hibira cannot be reached, the error is logged with Payload's logger and
the save goes through.

## Refresh Next.js pages

```tsx
// app/(frontend)/posts/[slug]/page.tsx
import { LiveRefresh } from '@hibira-io/payload/react';

export default async function Post({ params }) {
  const post = await getPost((await params).slug);
  return (
    <article>
      <LiveRefresh collection="posts" id={post.id} />
      <h1>{post.title}</h1>
      ...
    </article>
  );
}
```

`<LiveRefresh collection="posts" />` refreshes on any change in the
collection (a list page), and `<LiveRefresh global="header" />` on changes
to a global. Several changes within 300 ms (`delay`) make one refresh. For
your own handling:

```tsx
'use client';
import { useLiveChanges } from '@hibira-io/payload/react';

useLiveChanges({ collection: 'products', id }, (e) => setStock(e.doc?.stock));
```

## Other frontends

```ts
import { connect, subscribe } from '@hibira-io/payload/client';

const pusher = await connect({ key: 'your-app-key' });
const stop = subscribe(pusher, { collection: 'posts' }, (e) => console.log(e.operation, e.id));
```

## How much it costs

Each change is one message, however many pages receive it. Each open page
is one connection. The free plan has 100 connections and 200,000 messages a
day.

## Develop

```sh
npm test   # unit tests
# A real Payload (SQLite) against a Hibira-compatible server:
HIBIRA_E2E_APP_ID=... HIBIRA_E2E_KEY=... HIBIRA_E2E_SECRET=... HIBIRA_E2E_HOST=ws.hibira.io npm test
```

## License

[MIT](LICENSE)
