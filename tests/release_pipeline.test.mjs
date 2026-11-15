import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  datePrefix,
  nextVersion,
  isVersionCommit,
  releaseSource,
  releasePending,
  verifyAndBuild,
} from '../scripts/release-plugin.mjs';

test('Beijing midnight resets the date and sequence, numeric suffixes increase', () => {
  assert.equal(datePrefix(new Date('2026-10-14T15:59:59Z')), '2026.10.14');
  assert.equal(datePrefix(new Date('2026-10-14T16:00:00Z')), '2026.10.15');
  assert.equal(
    nextVersion(
      ['v2026.10.14.9', 'v2026.10.14.10'],
      '2026.10.14.10',
      new Date('2026-10-14T12:00:00Z'),
    ),
    '2026.10.14.11',
  );
  assert.equal(
    nextVersion(
      ['v2026.10.14.10'],
      '2026.10.14.10',
      new Date('2026-10-14T16:00:00Z'),
    ),
    '2026.10.15.0',
  );
});

test('legacy tomorrow version starts at .1 and resumes the real date without reusing tags', () => {
  assert.equal(
    nextVersion(
      ['v2026.10.15'],
      '2026.10.15',
      new Date('2026-10-14T12:00:00Z'),
    ),
    '2026.10.15.1',
  );
  assert.equal(
    nextVersion(
      ['v2026.10.15.1'],
      '2026.10.15.1',
      new Date('2026-10-15T12:00:00Z'),
    ),
    '2026.10.15.2',
  );
  assert.equal(
    nextVersion(
      ['v2026.10.15.2'],
      '2026.10.15.2',
      new Date('2026-10-16T12:00:00Z'),
    ),
    '2026.10.16.0',
  );
  assert.equal(
    nextVersion(
      ['v2026.2.30.999', 'v2026.2.28.3'],
      '2026.2.28.3',
      new Date('2026-02-28T12:00:00Z'),
    ),
    '2026.2.28.4',
  );
});

test('only generated version commits are skipped and source markers are exact SHA values', () => {
  assert.equal(
    isVersionCommit(
      'github-actions[bot]',
      'chore(release): bump to v2026.10.15.1',
    ),
    true,
  );
  assert.equal(
    isVersionCommit('developer', 'chore(release): bump to v2026.10.15.1'),
    false,
  );
  const sha = 'a'.repeat(40);
  assert.equal(releaseSource(`Notes\n\nSource commit: ${sha}`), sha);
  assert.equal(releaseSource('Source commit: main'), undefined);
});

function fixture(t, { documentation = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'bili-release-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = join(directory, 'remote.git'),
    sender = join(directory, 'sender'),
    root = join(directory, 'worker');
  const execute = (command, args, cwd) =>
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const git = (...args) => execute('git', args, sender);
  execute('git', ['init', '--bare', remote], directory);
  execute('git', ['init', '-b', 'main', sender], directory);
  git('config', 'user.name', 'developer');
  git('config', 'user.email', 'test@example.test');
  git('remote', 'add', 'origin', remote);
  writeFileSync(
    join(sender, 'plugin.json'),
    JSON.stringify({ version: '2026.10.15', entryPath: 'bili', name: 'Bili' }),
  );
  writeFileSync(
    join(sender, 'package.json'),
    JSON.stringify({ name: 'bili', version: '2026.10.15' }),
  );
  const commit = (text) => {
    writeFileSync(join(sender, 'code.txt'), text);
    git('add', '.');
    git('commit', '-m', text);
    return git('rev-parse', 'HEAD');
  };
  const changeFile = (path, text) => {
    const file = join(sender, path);
    mkdirSync(join(file, '..'), { recursive: true });
    if (text === null) rmSync(file);
    else writeFileSync(file, text);
    git('add', '.');
    git('commit', '-m', `docs: ${path}`);
    return git('rev-parse', 'HEAD');
  };
  commit('base');
  git('tag', 'v2026.10.15');
  git('push', 'origin', 'main', '--tags');
  const first = commit('first');
  if (documentation) changeFile('docs/images/example.svg', '<svg/>');
  const second = commit('second');
  if (documentation) changeFile('README.md', 'Read me');
  git('push', 'origin', 'main');
  execute('git', ['clone', '--branch', 'main', remote, root], directory);
  const releases = [],
    builds = [];
  let failPush = false,
    failBuild = false,
    appendCommit;
  const run = (command, args, cwd) => {
    if (command === 'gh') {
      if (args[0] === 'api') return JSON.stringify([releases]);
      assert.deepEqual(args.slice(0, 2), ['release', 'create']);
      const notes = args[args.indexOf('--notes') + 1];
      releases.push({
        tag_name: args[2],
        body: notes,
        draft: false,
        prerelease: false,
      });
      return '';
    }
    if (
      failPush &&
      command === 'git' &&
      args.join(' ') === 'push origin HEAD:main'
    )
      throw new Error('push rejected');
    return execute(command, args, cwd);
  };
  const build = (snapshot, source, version) => {
    if (failBuild && source === second) throw new Error('quality failed');
    builds.push({
      source,
      version,
      content: readFileSync(join(snapshot, 'code.txt'), 'utf8'),
    });
    if (appendCommit && source === first) {
      appendCommit();
      appendCommit = undefined;
    }
    const manifest = JSON.parse(readFileSync(join(snapshot, 'plugin.json')));
    mkdirSync(join(snapshot, 'dist/_build'), { recursive: true });
    writeFileSync(
      join(snapshot, 'dist/_build/plugin.json'),
      JSON.stringify({ ...manifest, entryHash: source, zipHash: source }),
    );
    writeFileSync(join(snapshot, 'dist/bili.jsplugin.zip'), source);
  };
  const publish = (options = {}) =>
    releasePending({
      root,
      repository: 'example/bili',
      run,
      build,
      ...options,
      now: () => new Date('2026-10-14T12:00:00Z'),
    });
  return {
    first,
    second,
    releases,
    builds,
    publish,
    root,
    git,
    execute,
    commit,
    changeFile,
    failPush: (value) => {
      failPush = value;
    },
    failBuild: (value) => {
      failBuild = value;
    },
    append: (callback) => {
      appendCommit = callback;
    },
  };
}

test('batch pushes and new commits during builds each get an immutable matching package/tag', (t) => {
  const f = fixture(t);
  let third;
  f.append(() => {
    third = f.commit('third');
    f.git('push', 'origin', 'main');
  });
  const result = f.publish();
  assert.deepEqual(
    result.map((item) => item.source),
    [f.first, f.second, third],
  );
  assert.deepEqual(
    result.map((item) => item.version),
    ['2026.10.15.1', '2026.10.15.2', '2026.10.15.3'],
  );
  for (const [i, item] of result.entries()) {
    assert.equal(
      f.execute('git', ['rev-parse', `v${item.version}^`], f.root),
      item.source,
    );
    assert.equal(
      f.execute('git', ['show', `v${item.version}:code.txt`], f.root),
      ['first', 'second', 'third'][i],
    );
    assert.equal(
      JSON.parse(
        f.execute('git', ['show', `v${item.version}:plugin.json`], f.root),
      ).version,
      item.version,
    );
  }
  assert.deepEqual(
    f.publish(),
    [],
    'queued reruns must not publish bot metadata commits',
  );
  assert.equal(f.releases.length, 3);
});

test('batch queue excludes documentation commits between code commits and at its tail', (t) => {
  const f = fixture(t, { documentation: true });
  const result = f.publish();
  assert.deepEqual(
    result.map((item) => item.source),
    [f.first, f.second],
  );
  assert.deepEqual(
    result.map((item) => item.version),
    ['2026.10.15.1', '2026.10.15.2'],
  );
  assert.equal(f.releases.length, 2);
  assert.deepEqual(
    f.publish(),
    [],
    'manual dispatch must not publish the documentation tail',
  );
});

test('documentation-only additions and deletions use no revision and later code resumes normally', (t) => {
  const f = fixture(t);
  f.publish();
  f.git('fetch', 'origin', 'main');
  f.git('merge', '--ff-only', 'origin/main');
  f.changeFile('README.MD', 'Only documentation');
  f.changeFile('笔记.md', 'Localized documentation');
  f.changeFile('docs/config.json', '{}');
  f.git('push', 'origin', 'main');
  assert.deepEqual(f.publish(), []);
  f.changeFile('README.MD', null);
  f.git('push', 'origin', 'main');
  assert.deepEqual(f.publish(), []);
  assert.equal(f.releases.length, 2);
  const third = f.commit('third');
  f.git('push', 'origin', 'main');
  assert.deepEqual(f.publish(), [{ source: third, version: '2026.10.15.3' }]);
  assert.equal(f.releases.length, 3);
});

test('failed checks never publish or advance that commit, rerun resumes the queue', (t) => {
  const f = fixture(t);
  f.failBuild(true);
  assert.throws(() => f.publish(), /quality failed/);
  assert.equal(f.releases.length, 1);
  assert.equal(
    JSON.parse(f.execute('git', ['show', 'origin/main:plugin.json'], f.root))
      .releaseSource,
    f.first,
  );
  f.failBuild(false);
  assert.deepEqual(
    f.publish().map((item) => item.source),
    [f.second],
  );
  assert.equal(f.releases.length, 2);
});

test('release success followed by metadata push failure is recovered without duplicate publication', (t) => {
  const f = fixture(t);
  f.failPush(true);
  assert.throws(() => f.publish(), /push rejected/);
  assert.equal(f.releases.length, 1);
  f.failPush(false);
  assert.deepEqual(
    f.publish().map((item) => item.source),
    [f.second],
  );
  assert.equal(f.releases.length, 2);
  assert.equal(f.builds.filter((item) => item.source === f.first).length, 1);
});

test('activation baseline excludes old commits without claiming they were published', (t) => {
  const f = fixture(t);
  const result = f.publish({ baseline: f.first });
  assert.deepEqual(
    result.map((item) => item.source),
    [f.second],
  );
  assert.equal(f.builds.length, 1);
  assert.equal(f.releases.length, 1);
  assert.equal(
    JSON.parse(f.execute('git', ['show', 'origin/main:plugin.json'], f.root))
      .releaseSource,
    f.second,
  );
});

test('new date after a legacy release starts with .0', () => {
  assert.equal(
    nextVersion(
      ['v2026.10.12'],
      '2026.10.12',
      new Date('2026-11-15T12:00:00Z'),
    ),
    '2026.11.15.0',
  );
});

test('release requires all checks and both native and Web outputs', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'bili-quality-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const commands = [];
  const run = (command, args) => {
    commands.push([command, ...args]);
    return '';
  };
  assert.throws(() => verifyAndBuild(directory, run), /Missing Lynx output/);
  assert.deepEqual(commands, [
    ['pnpm', 'install', '--frozen-lockfile'],
    ['npm', 'ci', '--prefix', 'frontend'],
    ['pnpm', 'exec', 'tsc', '--noEmit'],
    ['npm', 'run', 'typecheck', '--prefix', 'frontend'],
    ['pnpm', 'test'],
    ['pnpm', 'run', 'build'],
    ['pnpm', 'run', 'validate'],
  ]);
  const out = join(directory, 'dist/_build/static');
  mkdirSync(out, { recursive: true });
  for (const name of ['main.lynx.bundle', 'index.html'])
    writeFileSync(join(out, name), 'fixture');
  assert.throws(() => verifyAndBuild(directory, run), /main.web.bundle/);
  writeFileSync(join(out, 'main.web.bundle'), 'fixture');
  assert.doesNotThrow(() => verifyAndBuild(directory, run));
});
