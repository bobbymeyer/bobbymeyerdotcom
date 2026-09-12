import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const API = 'https://api.github.com';
const CACHE_DIR = join(process.cwd(), '.cache', 'github');

/**
 * How long a cached response is served without asking GitHub again. This is a
 * development convenience: a Netlify build starts with an empty `.cache`, so
 * every deploy reads GitHub fresh. Editing a stylesheet for an hour does not.
 */
const TTL_MS = 10 * 60 * 1000;

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';

/**
 * Unauthenticated GitHub allows 60 requests an hour, which is enough for a
 * handful of projects but not much else. A token — any token, no scopes
 * needed, the repositories are public — raises it to 5,000.
 */
export const hasToken = Boolean(token);

interface Cached {
  status: number;
  body: string;
  fetchedAt: number;
}

function cachePath(key: string): string {
  return join(CACHE_DIR, `${createHash('sha256').update(key).digest('hex')}.json`);
}

async function readCache(key: string): Promise<Cached | null> {
  try {
    return JSON.parse(await readFile(cachePath(key), 'utf8')) as Cached;
  } catch {
    return null;
  }
}

async function writeCache(key: string, entry: Cached): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(key), JSON.stringify(entry), 'utf8');
}

/**
 * One request, cached on disk.
 *
 * A 404 is an answer, not a failure — a repository with no releases says 404
 * to `/releases/latest` — so it is cached and returned like any other status.
 * Anything else that is not 2xx throws, and the caller decides. If the network
 * or the rate limit is what failed and there is a cached copy of any age, the
 * stale copy is served rather than losing the build over a blip.
 */
async function request(path: string, accept: string): Promise<{ status: number; body: string }> {
  const key = `${accept} ${path}`;
  const cached = await readCache(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return { status: cached.status, body: cached.body };
  }

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: {
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bobbymeyer.com',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (cause) {
    if (cached) return { status: cached.status, body: cached.body };
    throw new Error(`GitHub ${path}: ${(cause as Error).message}`, { cause });
  }

  const body = await response.text();

  if (!response.ok && response.status !== 404) {
    if (cached) return { status: cached.status, body: cached.body };
    // GitHub explains itself in the body, and a build that stops should say
    // what it was told rather than only the number it was told it with.
    let detail = body.slice(0, 300);
    try {
      detail = (JSON.parse(body) as { message?: string }).message ?? detail;
    } catch {
      /* not JSON; the first of it will do */
    }

    const spent = response.headers.get('x-ratelimit-remaining') === '0';
    throw new Error(
      `GitHub ${path} responded ${response.status}: ${detail}` +
        (spent && !hasToken
          ? ' — the hourly limit for unauthenticated requests is spent, set GITHUB_TOKEN.'
          : ''),
    );
  }

  await writeCache(key, { status: response.status, body, fetchedAt: Date.now() });
  return { status: response.status, body };
}

/** JSON from the API. `null` when GitHub says the thing does not exist. */
export async function ghJson<T>(path: string): Promise<T | null> {
  const { status, body } = await request(path, 'application/vnd.github+json');
  return status === 404 ? null : (JSON.parse(body) as T);
}

/** A rendered-HTML endpoint — the README, mainly. `null` on 404. */
export async function ghHtml(path: string): Promise<string | null> {
  const { status, body } = await request(path, 'application/vnd.github.html');
  return status === 404 ? null : body;
}

export interface Repo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  topics: string[];
  stargazers_count: number;
  created_at: string;
  pushed_at: string;
  default_branch: string;
  private: boolean;
  archived: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  user: { login: string } | null;
}

export interface Commit {
  sha: string;
  html_url: string;
  commit: { message: string; committer: { date: string } | null };
}

export interface Release {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
}

export interface Tag {
  name: string;
}
