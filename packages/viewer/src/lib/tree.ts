export interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children?: TreeNode[];
}

/**
 * Build a sorted tree from a flat list of page paths.
 * Folders come first, then files. Alphabetical within each group.
 * Strips `.md` extension from display names but preserves the full path.
 */
export function buildTree(pages: Array<{ path: string }>): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isFile: false, children: [] };

  for (const { path } of pages) {
    const parts = path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      let child = node.children?.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isFile: isLast,
          ...(isLast ? {} : { children: [] }),
        };
        node.children!.push(child);
      }
      node = child;
    }
  }

  const sort = (n: TreeNode) => {
    if (n.children) {
      n.children.sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      n.children.forEach(sort);
    }
  };
  sort(root);

  return root.children ?? [];
}

/**
 * Build crumbs for a page path: [{ name, path }] where each path is the cumulative slug.
 */
export function buildCrumbs(path: string): Array<{ name: string; path: string }> {
  const parts = path.replace(/\.md$/, '').split('/').filter(Boolean);
  const out: Array<{ name: string; path: string }> = [];
  let cumulative = '';
  for (const part of parts) {
    cumulative = cumulative ? `${cumulative}/${part}` : part;
    out.push({ name: part, path: cumulative });
  }
  return out;
}

/**
 * Extract headings from markdown body for a table of contents.
 * Returns level + text + slug. Skips H1 (typically the page title).
 */
export function extractToc(markdown: string): Array<{ level: number; text: string; slug: string }> {
  const lines = markdown.split('\n');
  const out: Array<{ level: number; text: string; slug: string }> = [];
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const m = /^(#{2,6})\s+(.+?)\s*#*$/.exec(line);
    if (m && m[1] && m[2]) {
      const level = m[1].length;
      const text = m[2].trim();
      const slug = slugify(text);
      out.push({ level, text, slug });
    }
  }
  return out;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Find the previous and next pages in the flat sorted list.
 */
export function findAdjacent<T extends { path: string }>(
  pages: T[],
  currentPath: string,
): { prev: T | null; next: T | null } {
  const idx = pages.findIndex((p) => p.path === currentPath);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? pages[idx - 1]! : null,
    next: idx < pages.length - 1 ? pages[idx + 1]! : null,
  };
}
