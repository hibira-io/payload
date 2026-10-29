import Pusher from 'pusher';
import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionConfig,
  Config,
  GlobalAfterChangeHook,
  GlobalConfig,
  Plugin,
} from 'payload';
import { channelFor, DEFAULT_PREFIX, EVENT, type ChangeEvent, type Operation } from './channels.js';

export { channelFor, DEFAULT_PREFIX, EVENT } from './channels.js';
export type { ChangeEvent, Operation, Target } from './channels.js';

export interface WatchOptions {
  /**
   * Document fields to send with each event, such as ['title', 'slug'].
   * By default events carry only the ID, operation, updatedAt and status:
   * channels are public, so send nothing a visitor may not see.
   */
  fields?: string[];
  /**
   * With drafts on, events go out only for published documents (the public
   * content changed). 'all' sends draft saves too, for admin dashboards.
   */
  drafts?: 'published' | 'all';
  /** More channels for an event, such as one per author or category. */
  channels?: (doc: Record<string, any>) => string[];
}

export interface HibiraPluginOptions {
  /** Defaults to HIBIRA_APP_ID. */
  appId?: string;
  /** Defaults to HIBIRA_APP_KEY, then NEXT_PUBLIC_HIBIRA_APP_KEY. */
  key?: string;
  /** Defaults to HIBIRA_APP_SECRET. */
  secret?: string;
  /** Defaults to HIBIRA_HOST, then NEXT_PUBLIC_HIBIRA_HOST, then ws.hibira.io. */
  host?: string;
  port?: number;
  useTLS?: boolean;
  /** Collections to watch: `{ posts: true, pages: { fields: ['title'] } }`. */
  collections?: Record<string, true | WatchOptions>;
  /** Globals to watch: `{ header: true }`. */
  globals?: Record<string, true | WatchOptions>;
  /** Channel name prefix. Default 'payload'. */
  prefix?: string;
  /**
   * Wait for Hibira's answer before the save returns (default). False sends
   * in the background, which saves a round trip but may be cut off on
   * serverless hosts.
   */
  wait?: boolean;
  /** Turns the plugin off, for example in tests. Default true. */
  enabled?: boolean;
  /** A ready client instead of the credentials above (tests, custom agents). */
  client?: Pick<Pusher, 'trigger'>;
}

/** Hibira refuses events larger than this. */
const MAX_DATA = 10 * 1024;

type Sender = (channels: string[], data: ChangeEvent, log: Logger) => Promise<void>;
type Logger = { error: (obj: unknown, msg?: string) => void };

/**
 * Sends a `change` event to payload-{collection}, payload-{collection}-{id}
 * and payload-global-{slug} when watched content is created, updated,
 * published or deleted.
 *
 *     plugins: [hibiraPlugin({ collections: { posts: true }, globals: { header: true } })]
 *
 * Skip events for one operation with `context: { hibira: false }`.
 */
export function hibiraPlugin(options: HibiraPluginOptions = {}): Plugin {
  return (config: Config): Config => {
    if (options.enabled === false) return config;
    const prefix = options.prefix ?? DEFAULT_PREFIX;
    const send = sender(options);
    const watchedCollections = options.collections ?? {};
    const watchedGlobals = options.globals ?? {};

    for (const slug of Object.keys(watchedCollections)) {
      if (!config.collections?.some((c) => c.slug === slug)) {
        throw new Error(`@hibira-io/payload: no collection "${slug}" in the config`);
      }
    }
    for (const slug of Object.keys(watchedGlobals)) {
      if (!config.globals?.some((g) => g.slug === slug)) {
        throw new Error(`@hibira-io/payload: no global "${slug}" in the config`);
      }
    }

    return {
      ...config,
      collections: config.collections?.map((c) =>
        c.slug in watchedCollections ? watchCollection(c, opts(watchedCollections[c.slug]), prefix, send) : c,
      ),
      globals: config.globals?.map((g) =>
        g.slug in watchedGlobals ? watchGlobal(g, opts(watchedGlobals[g.slug]), prefix, send) : g,
      ),
    };
  };
}

function opts(o: true | WatchOptions): WatchOptions {
  return o === true ? {} : o;
}

function hasDrafts(versions: CollectionConfig['versions'] | GlobalConfig['versions']): boolean {
  return typeof versions === 'object' && versions !== null && Boolean(versions.drafts);
}

function watchCollection(c: CollectionConfig, o: WatchOptions, prefix: string, send: Sender): CollectionConfig {
  const drafts = hasDrafts(c.versions);

  const afterChange: CollectionAfterChangeHook = async ({ doc, operation, context, req }) => {
    if (context?.hibira === false) return doc;
    if (drafts && o.drafts !== 'all' && doc?._status !== 'published') return doc;
    const data = event({ collection: c.slug, id: doc.id, operation }, doc, o);
    await send(
      [channelFor({ collection: c.slug }, prefix), channelFor({ collection: c.slug, id: doc.id }, prefix), ...(o.channels?.(doc) ?? [])],
      data,
      req.payload.logger,
    );
    return doc;
  };

  const afterDelete: CollectionAfterDeleteHook = async ({ doc, id, context, req }) => {
    if (context?.hibira === false) return doc;
    const data = event({ collection: c.slug, id, operation: 'delete' }, doc, { ...o, fields: [] });
    await send(
      [channelFor({ collection: c.slug }, prefix), channelFor({ collection: c.slug, id }, prefix), ...(doc ? (o.channels?.(doc) ?? []) : [])],
      data,
      req.payload.logger,
    );
    return doc;
  };

  return {
    ...c,
    hooks: {
      ...c.hooks,
      afterChange: [...(c.hooks?.afterChange ?? []), afterChange],
      afterDelete: [...(c.hooks?.afterDelete ?? []), afterDelete],
    },
  };
}

function watchGlobal(g: GlobalConfig, o: WatchOptions, prefix: string, send: Sender): GlobalConfig {
  const drafts = hasDrafts(g.versions);
  const afterChange: GlobalAfterChangeHook = async ({ doc, context, req }) => {
    if (context?.hibira === false) return doc;
    if (drafts && o.drafts !== 'all' && doc?._status !== 'published') return doc;
    const data = event({ global: g.slug, operation: 'update' }, doc, o);
    await send([channelFor({ global: g.slug }, prefix), ...(o.channels?.(doc) ?? [])], data, req.payload.logger);
    return doc;
  };
  return {
    ...g,
    hooks: { ...g.hooks, afterChange: [...(g.hooks?.afterChange ?? []), afterChange] },
  };
}

function event(
  base: { collection?: string; global?: string; id?: string | number; operation: Operation },
  doc: Record<string, any> | undefined,
  o: WatchOptions,
): ChangeEvent {
  const data: ChangeEvent = { ...base };
  if (doc?.updatedAt) data.updatedAt = String(doc.updatedAt);
  if (doc?._status === 'draft' || doc?._status === 'published') data.status = doc._status;
  if (doc && o.fields?.length) {
    data.doc = Object.fromEntries(o.fields.filter((f) => f in doc).map((f) => [f, doc[f]]));
    if (JSON.stringify(data).length > MAX_DATA) {
      delete data.doc;
      data.truncated = true;
    }
  }
  return data;
}

function sender(options: HibiraPluginOptions): Sender {
  let client = options.client;
  const wait = options.wait !== false;
  return async (channels, data, log) => {
    try {
      client ??= createClient(options);
    } catch (err) {
      log.error({ err }, '@hibira-io/payload: not configured, no event sent');
      return;
    }
    const unique = [...new Set(channels)].slice(0, 100);
    const p = client.trigger(unique, EVENT, data).then(
      () => undefined,
      (err: unknown) => log.error({ err, channels: unique }, '@hibira-io/payload: event not sent'),
    );
    if (wait) await p;
  };
}

function createClient(o: HibiraPluginOptions): Pusher {
  const env = process.env;
  const appId = o.appId ?? env.HIBIRA_APP_ID;
  const key = o.key ?? env.HIBIRA_APP_KEY ?? env.NEXT_PUBLIC_HIBIRA_APP_KEY;
  const secret = o.secret ?? env.HIBIRA_APP_SECRET;
  if (!appId || !key || !secret) {
    throw new Error('set appId, key and secret, or HIBIRA_APP_ID, HIBIRA_APP_KEY and HIBIRA_APP_SECRET');
  }
  const useTLS = o.useTLS ?? (env.HIBIRA_SCHEME ?? env.NEXT_PUBLIC_HIBIRA_SCHEME ?? 'https') === 'https';
  const port = o.port ?? Number(env.HIBIRA_PORT ?? env.NEXT_PUBLIC_HIBIRA_PORT ?? (useTLS ? 443 : 80));
  return new Pusher({
    appId,
    key,
    secret,
    host: o.host ?? env.HIBIRA_HOST ?? env.NEXT_PUBLIC_HIBIRA_HOST ?? 'ws.hibira.io',
    port: String(port),
    useTLS,
  });
}
