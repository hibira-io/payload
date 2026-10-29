import { describe, expect, it, vi } from 'vitest';
import type { CollectionConfig, Config, GlobalConfig } from 'payload';
import { hibiraPlugin } from '../src/index.js';

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] };
const pages: CollectionConfig = { slug: 'pages', versions: { drafts: true }, fields: [{ name: 'title', type: 'text' }] };
const header: GlobalConfig = { slug: 'header', fields: [{ name: 'nav', type: 'text' }] };

function setup(options: Parameters<typeof hibiraPlugin>[0], extra: Partial<Config> = {}) {
  const trigger = vi.fn(async () => ({}));
  const base = { collections: [posts, pages], globals: [header], ...extra } as Config;
  const config = hibiraPlugin({ client: { trigger } as any, ...options })(base) as Config;
  const logger = { error: vi.fn() };
  const req = { payload: { logger } } as any;
  const coll = (slug: string) => config.collections!.find((c) => c.slug === slug)!;
  const glob = (slug: string) => config.globals!.find((g) => g.slug === slug)!;
  return { trigger, config, req, logger, coll, glob };
}

describe('hibiraPlugin', () => {
  it('sends create and update events to the collection and document channels', async () => {
    const { trigger, coll, req } = setup({ collections: { posts: true } });
    const hook = coll('posts').hooks!.afterChange!.at(-1)!;
    const doc = { id: 7, title: 'Hello', updatedAt: '2026-10-29T00:00:00.000Z' };
    expect(await hook({ doc, operation: 'create', context: {}, req } as any)).toBe(doc);
    expect(trigger).toHaveBeenCalledWith(['payload-posts', 'payload-posts-7'], 'change', {
      collection: 'posts',
      id: 7,
      operation: 'create',
      updatedAt: '2026-10-29T00:00:00.000Z',
    });
  });

  it('sends only the listed fields', async () => {
    const { trigger, coll, req } = setup({ collections: { posts: { fields: ['title', 'missing'] } } });
    await coll('posts').hooks!.afterChange!.at(-1)!({ doc: { id: 1, title: 'T', secret: 'x' }, operation: 'update', context: {}, req } as any);
    expect(trigger.mock.calls[0][2]).toMatchObject({ doc: { title: 'T' } });
    expect((trigger.mock.calls[0][2] as any).doc).not.toHaveProperty('secret');
  });

  it('drops the fields when the event would pass 10 KB', async () => {
    const { trigger, coll, req } = setup({ collections: { posts: { fields: ['title'] } } });
    await coll('posts').hooks!.afterChange!.at(-1)!({ doc: { id: 1, title: 'x'.repeat(11000) }, operation: 'update', context: {}, req } as any);
    expect(trigger.mock.calls[0][2]).toMatchObject({ truncated: true });
    expect(trigger.mock.calls[0][2]).not.toHaveProperty('doc');
  });

  it('skips drafts unless asked, and sends published saves with their status', async () => {
    const { trigger, coll, req } = setup({ collections: { pages: true } });
    const hook = coll('pages').hooks!.afterChange!.at(-1)!;
    await hook({ doc: { id: 2, _status: 'draft' }, operation: 'update', context: {}, req } as any);
    expect(trigger).not.toHaveBeenCalled();
    await hook({ doc: { id: 2, _status: 'published' }, operation: 'update', context: {}, req } as any);
    expect(trigger.mock.calls[0][2]).toMatchObject({ status: 'published' });

    const all = setup({ collections: { pages: { drafts: 'all' } } });
    await all.coll('pages').hooks!.afterChange!.at(-1)!({ doc: { id: 2, _status: 'draft' }, operation: 'update', context: {}, req } as any);
    expect(all.trigger.mock.calls[0][2]).toMatchObject({ status: 'draft' });
  });

  it('sends deletes without fields', async () => {
    const { trigger, coll, req } = setup({ collections: { posts: { fields: ['title'] } } });
    await coll('posts').hooks!.afterDelete!.at(-1)!({ doc: { id: 3, title: 'gone' }, id: 3, context: {}, req } as any);
    expect(trigger).toHaveBeenCalledWith(['payload-posts', 'payload-posts-3'], 'change', { collection: 'posts', id: 3, operation: 'delete' });
  });

  it('sends global updates and extra channels, without duplicates', async () => {
    const { trigger, glob, req } = setup({ globals: { header: { channels: () => ['site', 'payload-global-header'] } }, prefix: 'cms' });
    await glob('header').hooks!.afterChange!.at(-1)!({ doc: { nav: 'x' }, context: {}, req } as any);
    expect(trigger).toHaveBeenCalledWith(['cms-global-header', 'site', 'payload-global-header'], 'change', { global: 'header', operation: 'update' });
  });

  it('skips an operation with context.hibira = false', async () => {
    const { trigger, coll, req } = setup({ collections: { posts: true } });
    await coll('posts').hooks!.afterChange!.at(-1)!({ doc: { id: 1 }, operation: 'create', context: { hibira: false }, req } as any);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('keeps existing hooks and leaves unwatched collections alone', () => {
    const mine = vi.fn();
    const withHook = { ...posts, hooks: { afterChange: [mine] } };
    const { config } = setup({ collections: { posts: true } }, { collections: [withHook, pages] });
    const c = config.collections!.find((x) => x.slug === 'posts')!;
    expect(c.hooks!.afterChange![0]).toBe(mine);
    expect(c.hooks!.afterChange).toHaveLength(2);
    expect(config.collections!.find((x) => x.slug === 'pages')).toBe(pages);
  });

  it('logs instead of failing the save when Hibira refuses', async () => {
    const { coll, req, logger, trigger } = setup({ collections: { posts: true } });
    trigger.mockRejectedValueOnce(new Error('401'));
    await expect(coll('posts').hooks!.afterChange!.at(-1)!({ doc: { id: 1 }, operation: 'create', context: {}, req } as any)).resolves.toBeTruthy();
    expect(logger.error).toHaveBeenCalled();
  });

  it('refuses a slug that is not in the config', () => {
    expect(() => setup({ collections: { nope: true } })).toThrow(/no collection "nope"/);
  });

  it('does nothing when disabled', () => {
    const base = { collections: [posts] } as Config;
    expect(hibiraPlugin({ enabled: false, collections: { posts: true } })(base)).toBe(base);
  });
});
