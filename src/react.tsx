'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { connect, subscribe, type ConnectOptions } from './client.js';
import { DEFAULT_PREFIX, type ChangeEvent, type Target } from './channels.js';

export type LiveOptions = Partial<ConnectOptions> & { prefix?: string };

function connection(o: LiveOptions): ConnectOptions {
  return {
    key: o.key ?? process.env.NEXT_PUBLIC_HIBIRA_APP_KEY ?? '',
    host: o.host ?? process.env.NEXT_PUBLIC_HIBIRA_HOST ?? undefined,
    port: o.port ?? (process.env.NEXT_PUBLIC_HIBIRA_PORT ? Number(process.env.NEXT_PUBLIC_HIBIRA_PORT) : undefined),
    tls: o.tls ?? (process.env.NEXT_PUBLIC_HIBIRA_SCHEME ? process.env.NEXT_PUBLIC_HIBIRA_SCHEME === 'https' : undefined),
  };
}

/**
 * Calls `onChange` for each change to the targets while the component is
 * mounted. The key and host default to NEXT_PUBLIC_HIBIRA_APP_KEY and
 * NEXT_PUBLIC_HIBIRA_HOST.
 */
export function useLiveChanges<T = Record<string, unknown>>(
  targets: Target | Target[],
  onChange: (event: ChangeEvent<T>) => void,
  options: LiveOptions = {},
): void {
  const handler = useRef(onChange);
  handler.current = onChange;
  const list = Array.isArray(targets) ? targets : [targets];
  const deps = JSON.stringify([list, options]);
  useEffect(() => {
    const conn = connection(options);
    if (!conn.key) {
      console.warn('@hibira-io/payload: set NEXT_PUBLIC_HIBIRA_APP_KEY or pass key');
      return;
    }
    let stops: (() => void)[] = [];
    let cancelled = false;
    connect(conn).then((pusher) => {
      if (cancelled) return;
      stops = list.map((t) => subscribe<T>(pusher, t, (e) => handler.current(e), options.prefix ?? DEFAULT_PREFIX));
    });
    return () => {
      cancelled = true;
      stops.forEach((s) => s());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);
}

/**
 * Re-renders the current page's server components when its content changes,
 * with router.refresh(). Put it in a page or layout:
 *
 *     <LiveRefresh collection="posts" id={post.id} />
 *     <LiveRefresh global="header" />
 */
export function LiveRefresh(props: (Target extends infer U ? U : never) & LiveOptions & { delay?: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const target: Target =
    'global' in props && props.global ? { global: props.global } : { collection: (props as { collection: string }).collection, id: (props as { id?: string | number }).id };
  useLiveChanges(
    target,
    () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), props.delay ?? 300);
    },
    props,
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return null;
}
