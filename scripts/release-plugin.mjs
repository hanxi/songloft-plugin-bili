import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function datePrefix(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((key) => parts.find((p) => p.type === key).value)
    .join('.');
}

function versionParts(version) {
  const match = /^v?(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\.(\d+))?$/.exec(version);
  if (!match) return null;
  const parts = match
    .slice(1)
    .map((value) => (value === undefined ? undefined : Number(value)));
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2] ||
    (parts[3] !== undefined && !Number.isSafeInteger(parts[3]))
  )
    return null;
  return parts;
}

export function nextVersion(tags, currentVersion, now = new Date()) {
  let date = versionParts(datePrefix(now)).slice(0, 3);
  const current = versionParts(currentVersion);
  // 过渡版曾使用明日日期：日期追上之前沿用该前缀，不能让商店判为降级。
  if (
    current &&
    current
      .slice(0, 3)
      .some(
        (value, i) =>
          value > date[i] &&
          current.slice(0, i).every((prefix, j) => prefix === date[j]),
      )
  )
    date = current.slice(0, 3);
  const prefix = date.join('.');
  const revisions = tags
    .map(versionParts)
    .filter(
      (parts) =>
        parts &&
        parts.slice(0, 3).join('.') === prefix &&
        parts[3] !== undefined,
    )
    .map((parts) => parts[3]);
  // 三段 D 与四段 D.0 数值相同，迁移当日需从 .1 开始才能提示升级。
  const legacy = tags
    .map(versionParts)
    .some(
      (parts) =>
        parts &&
        parts.slice(0, 3).join('.') === prefix &&
        parts[3] === undefined,
    );
  const revision = revisions.length
    ? Math.max(...revisions) + 1
    : legacy
      ? 1
      : 0;
  if (!Number.isSafeInteger(revision) || revision > 999999999)
    throw new Error('Daily release sequence exhausted');
  return `${prefix}.${revision}`;
}

export function isVersionCommit(author, subject) {
  return (
    author === 'github-actions[bot]' &&
    subject.startsWith('chore(release): bump to v')
  );
}

function hasPackageChanges(paths) {
  return paths.some((path) => !/^docs\//.test(path) && !/\.mdx?$/i.test(path));
}

export function releaseSource(body = '') {
  return /^Source commit: ([a-f0-9]{40})$/m.exec(body)?.[1];
}

const execute = (command, args, cwd, capture = true) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })?.trim() ?? '';

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function writeJSON(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function verifyAndBuild(snapshot, run = execute) {
  run('pnpm', ['install', '--frozen-lockfile'], snapshot, false);
  run('npm', ['ci', '--prefix', 'frontend'], snapshot, false);
  run('pnpm', ['exec', 'tsc', '--noEmit'], snapshot, false);
  run('npm', ['run', 'typecheck', '--prefix', 'frontend'], snapshot, false);
  run('pnpm', ['test'], snapshot, false);
  run('pnpm', ['run', 'build'], snapshot, false);
  run('pnpm', ['run', 'validate'], snapshot, false);
  for (const file of ['main.lynx.bundle', 'main.web.bundle', 'index.html']) {
    if (!existsSync(join(snapshot, 'dist/_build/static', file)))
      throw new Error(`Missing Lynx output: ${file}`);
  }
}

export function releasePending({
  root,
  repository,
  baseline,
  now = () => new Date(),
  run = execute,
  build,
} = {}) {
  const git = (...args) => run('git', args, root);
  const gh = (...args) => run('gh', args, root);
  const staging = mkdtempSync(join(tmpdir(), 'bili-release-'));
  const plugins = join(staging, 'plugins');
  mkdirSync(join(plugins, 'src'), { recursive: true });
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', 'github-actions[bot]@users.noreply.github.com');
  const published = [];

  function markPublished(source, version, manifest) {
    // main 可能已收到后续业务提交。只同步发布元数据，快进冲突时重新应用。
    for (let attempt = 0; attempt < 3; attempt++) {
      git('fetch', 'origin', 'main');
      git('checkout', '--detach', 'origin/main');
      const current = readJSON(join(root, 'plugin.json'));
      Object.assign(current, {
        version,
        releaseSource: source,
        download_url: `https://github.com/${repository}/releases/download/v${version}/${current.entryPath}.jsplugin.zip`,
        entryHash: manifest.entryHash,
        zipHash: manifest.zipHash,
      });
      writeJSON(join(root, 'plugin.json'), current);
      const pkg = readJSON(join(root, 'package.json'));
      pkg.version = version;
      writeJSON(join(root, 'package.json'), pkg);
      git('add', 'plugin.json', 'package.json');
      git(
        'commit',
        '-m',
        `chore(release): bump to v${version}\n\nSource commit: ${source}`,
      );
      try {
        git('push', 'origin', 'HEAD:main');
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }

  while (true) {
    git('fetch', 'origin', 'main', '--tags');
    const current = JSON.parse(git('show', 'origin/main:plugin.json'));
    const base =
      current.releaseSource ||
      baseline ||
      git('rev-parse', `v${current.version}^{commit}`);
    if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid release source');
    git('merge-base', '--is-ancestor', base, 'origin/main');
    const pending = git(
      'log',
      '--first-parent',
      '--reverse',
      '--format=%H%x09%an%x09%s',
      `${base}..origin/main`,
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'))
      .filter(
        ([source, author, subject]) =>
          !isVersionCommit(author, subject) &&
          hasPackageChanges(
            git(
              'diff',
              '--name-only',
              '--no-renames',
              '-z',
              `${source}^`,
              source,
            )
              .split('\0')
              .filter(Boolean),
          ),
      );
    if (!pending.length) break;
    const [source] = pending[0];
    // 发布成功、main 元数据写入失败时，重跑接回已发布包，不重复发同一提交。
    const releases = JSON.parse(
      gh(
        'api',
        '--paginate',
        '--slurp',
        `repos/${repository}/releases?per_page=100`,
      ),
    ).flat();
    const existing = releases.find(
      (item) =>
        !item.draft && !item.prerelease && releaseSource(item.body) === source,
    );
    if (existing) {
      const manifest = JSON.parse(
        git('show', `${existing.tag_name}:plugin.json`),
      );
      markPublished(source, manifest.version, manifest);
      continue;
    }
    const version = nextVersion(
      git('tag', '--list').split('\n'),
      current.version,
      now(),
    );
    const snapshot = join(plugins, 'src', source);
    git('worktree', 'add', '--detach', snapshot, source);
    try {
      const manifest = readJSON(join(snapshot, 'plugin.json'));
      manifest.version = version;
      manifest.releaseSource = source;
      manifest.download_url = `https://github.com/${repository}/releases/download/v${version}/${manifest.entryPath}.jsplugin.zip`;
      writeJSON(join(snapshot, 'plugin.json'), manifest);
      const pkg = readJSON(join(snapshot, 'package.json'));
      pkg.version = version;
      writeJSON(join(snapshot, 'package.json'), pkg);
      if (build) build(snapshot, source, version);
      else verifyAndBuild(snapshot, run);
      const built = readJSON(join(snapshot, 'dist/_build/plugin.json'));
      Object.assign(manifest, {
        entryHash: built.entryHash,
        zipHash: built.zipHash,
      });
      writeJSON(join(snapshot, 'plugin.json'), manifest);
      run('git', ['add', 'plugin.json', 'package.json'], snapshot);
      run(
        'git',
        [
          'commit',
          '-m',
          `chore(release): bump to v${version}\n\nSource commit: ${source}`,
        ],
        snapshot,
      );
      const tag = `v${version}`;
      // tag 指向对应源码加版本元数据的快照，不能在较新的 main 上为旧产物打 tag。
      run('git', ['push', 'origin', `HEAD:refs/tags/${tag}`], snapshot);
      gh(
        'release',
        'create',
        tag,
        join(snapshot, `dist/${manifest.entryPath}.jsplugin.zip`),
        '--repo',
        repository,
        '--verify-tag',
        '--latest',
        '--title',
        tag,
        '--notes',
        `自动构建的哔哩音乐插件 ${tag}\n\nSource commit: ${source}`,
      );
      markPublished(source, version, manifest);
      published.push({ source, version });
    } finally {
      git('worktree', 'remove', '--force', snapshot);
    }
  }
  return published;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Release requires main');
  console.log(
    releasePending({
      root,
      repository: process.env.GITHUB_REPOSITORY,
      baseline: process.env.RELEASE_BASE_SHA,
    }),
  );
}
