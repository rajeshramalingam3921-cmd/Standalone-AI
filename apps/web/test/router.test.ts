import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from '../src/router';
import { splitStack } from '../src/components/NewProject';

const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('hash router', () => {
  it('parses known routes', () => {
    expect(parseRoute('')).toEqual({ name: 'dashboard' });
    expect(parseRoute('#/projects/new')).toEqual({ name: 'new-project' });
    expect(parseRoute(`#/projects/${id}`)).toEqual({ name: 'project', projectId: id });
  });

  it('falls back to the dashboard for anything unexpected', () => {
    expect(parseRoute('#/projects/../../etc')).toEqual({ name: 'dashboard' });
    expect(parseRoute('#/projects/<script>')).toEqual({ name: 'dashboard' });
  });

  it('round-trips href → parseRoute', () => {
    const routes: Route[] = [
      { name: 'dashboard' },
      { name: 'new-project' },
      { name: 'project', projectId: id },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });
});

describe('splitStack', () => {
  it('splits, trims and de-duplicates', () => {
    expect(splitStack(' React, Node ,,React ')).toEqual(['React', 'Node']);
  });
});
