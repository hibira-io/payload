import type Pusher from 'pusher-js';
import { channelFor, DEFAULT_PREFIX, EVENT, type ChangeEvent, type Target } from './channels.js';

export { channelFor, DEFAULT_PREFIX, EVENT } from './channels.js';
export type { ChangeEvent, Target } from './channels.js';

export interface ConnectOptions {
  key: string;
  /** Default ws.hibira.io. */
  host?: string;
  port?: number;
  /** Default true. */
  tls?: boolean;
}

let shared: Pusher | undefined;

/** One pusher-js connection for the page, created on first use. */
export async function connect(o: ConnectOptions): Promise<Pusher> {
  if (shared) return shared;
  const { default: PusherJS } = await import('pusher-js');
  const tls = o.tls ?? true;
  const port = o.port ?? (tls ? 443 : 80);
  shared = new PusherJS(o.key, {
    cluster: 'hkg', // required by pusher-js, unused once wsHost is set
    wsHost: o.host ?? 'ws.hibira.io',
    wsPort: port,
    wssPort: port,
    forceTLS: tls,
    enabledTransports: ['ws', 'wss'],
  });
  return shared;
}

/**
 * Calls `onChange` for every change to a collection, a document or a global.
 * Returns a function that stops listening.
 *
 *     const stop = subscribe(pusher, { collection: 'posts', id: post.id }, (e) => reload());
 */
export function subscribe<T = Record<string, unknown>>(
  pusher: Pusher,
  target: Target,
  onChange: (event: ChangeEvent<T>) => void,
  prefix = DEFAULT_PREFIX,
): () => void {
  const name = channelFor(target, prefix);
  const channel = pusher.channel(name) ?? pusher.subscribe(name);
  const handler = (e: ChangeEvent<T>) => onChange(e);
  channel.bind(EVENT, handler);
  return () => {
    channel.unbind(EVENT, handler);
    if (!channel.callbacks.get(EVENT)?.length) pusher.unsubscribe(name);
  };
}
