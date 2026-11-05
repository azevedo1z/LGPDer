/**
 * Reading of the Markdown documents and of the source of the repository, for the tests of the
 * documentation: headings and their anchors as GitHub renders them, relative links, code spans of
 * the `[lgpder]` messages, and the messages the source throws or warns.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

/** Root of the repository. */
const ROOT = new URL('../../', import.meta.url);

/** Text of the file at `path`, relative to the root and with `/`. */
export function readText(path: string): string {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

/** Paths of the files directly under the directory `dir` whose name ends in `extension`. */
function filesIn(dir: string, extension: string): string[] {
  return readdirSync(new URL(`${dir}/`, ROOT))
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => `${dir}/${name}`);
}

/** Every Markdown document: the READMEs, the changelog and the guides of `docs/`. */
export function documentPaths(): string[] {
  return ['README.md', 'README.pt-BR.md', 'CHANGELOG.md', ...filesIn('docs', '.md')];
}

/** Every TypeScript file of `src/`, at any depth. */
export function sourcePaths(): string[] {
  return readdirSync(new URL('src/', ROOT), { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `src/${name.replaceAll('\\', '/')}`);
}

/** The lines of `markdown` outside fenced code blocks. */
function proseLines(markdown: string): string[] {
  let fenced = false;
  return markdown.split('\n').filter((line) => {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

/**
 * Anchor of a heading as GitHub writes it: lower case, without punctuation and symbols (including
 * the backticks of code), and spaces turned into hyphens.
 */
function slugOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replaceAll(' ', '-');
}

/** The anchors of the headings of `markdown`; a repeated one gets `-1`, `-2` and so on. */
export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of proseLines(markdown)) {
    const heading = /^#{1,6} (.+)$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const slug = slugOf(heading);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${String(count)}`);
  }
  return anchors;
}

/** A relative link of a document: the path of its target, from the root, and its anchor. */
export interface Link {
  readonly text: string;
  /** Target, relative to the root and with `/`. */
  readonly path: string;
  /** Anchor without `#`, or `undefined`. */
  readonly anchor: string | undefined;
}

/** The relative links of the document at `path`; links with a scheme are left out. */
export function relativeLinksOf(path: string, markdown: string): Link[] {
  const links: Link[] = [];
  for (const line of proseLines(markdown)) {
    for (const [, text = '', target = ''] of line.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      const [file = '', anchor] = target.split('#');
      links.push({
        text,
        path: file === '' ? path : posix.normalize(posix.join(posix.dirname(path), file)),
        anchor,
      });
    }
  }
  return links;
}

/**
 * The messages a document shows in code spans, alone, such as `` `[lgpder] Unknown option: "x".` ``,
 * or as the argument of an error, such as `` `Error('[lgpder] This instance was destroyed.')` ``.
 */
export function documentedMessages(markdown: string): string[] {
  return [
    ...markdown.matchAll(/`(\[lgpder\] [^`]+)`/g),
    ...markdown.matchAll(/`[A-Za-z]+\('(\[lgpder\] [^']+)'\)`/g),
  ].map(([, message = '']) => message);
}

/** How many times `[lgpder]` appears in `source`, in literals or anywhere else. */
export function prefixCount(source: string): number {
  return source.split('[lgpder]').length - 1;
}

/** Escapes `text` for a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The messages that `source` throws or warns, as patterns: each string, in single or double quotes,
 * or template literal that starts with `[lgpder]`, with every interpolation (`${...}`) matching any
 * text.
 */
export function sourceMessages(source: string): RegExp[] {
  const literals = [
    ...source.matchAll(/'(\[lgpder\][^'\\]*)'/g),
    ...source.matchAll(/"(\[lgpder\][^"\\]*)"/g),
    ...source.matchAll(/`(\[lgpder\][^`]*)`/g),
  ].map(([, literal = '']) => literal);
  return literals.map(
    (literal) =>
      new RegExp(
        `^${literal
          .split(/\$\{[^}]*\}/)
          .map(escapeRegExp)
          .join('.+?')}$`,
      ),
  );
}
