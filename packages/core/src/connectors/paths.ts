import path from 'node:path';

/**
 * Resolve a connector's `target` (where inside content/ it lands) to an absolute
 * path, refusing anything that escapes the content root OR resolves to the content
 * root itself. The latter is the dangerous case: `target: ''` made `targetAbs` equal
 * the content root, and the orphan-cleanup pass then deleted every hand-written page
 * that wasn't part of the sync. A connector must own a sub-folder, never the root.
 */
export function resolveConnectorTarget(contentRoot: string, target: string): string {
  const normalized = path.normalize(target).replace(/^[/\\]+/, '');
  const abs = path.resolve(contentRoot, normalized);
  const rel = path.relative(contentRoot, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `connector target "${target}" must resolve to a folder inside content/, not the content root or outside it`,
    );
  }
  return abs;
}
