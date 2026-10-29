// Channel names, shared by the server plugin and the browser helpers.

export const DEFAULT_PREFIX = 'payload';

/** The one event name; its data says what happened. */
export const EVENT = 'change';

export type Operation = 'create' | 'update' | 'delete';

export interface ChangeEvent<T = Record<string, unknown>> {
  /** Collection slug; absent for globals. */
  collection?: string;
  /** Global slug; absent for collections. */
  global?: string;
  id?: string | number;
  operation: Operation;
  updatedAt?: string;
  /** Draft status, for collections and globals with drafts. */
  status?: 'draft' | 'published';
  /** The fields you listed in the plugin's `fields` option. */
  doc?: Partial<T>;
  /** True when `doc` was left out because the event would pass 10 KB. */
  truncated?: boolean;
}

export type Target = { collection: string; id?: string | number } | { global: string };

/** payload-{collection}, payload-{collection}-{id} or payload-global-{slug}. */
export function channelFor(target: Target, prefix = DEFAULT_PREFIX): string {
  if ('global' in target) return `${prefix}-global-${target.global}`;
  return target.id === undefined ? `${prefix}-${target.collection}` : `${prefix}-${target.collection}-${target.id}`;
}
