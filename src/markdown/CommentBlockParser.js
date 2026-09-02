import { formatComment } from './MarkdownFormatter.js';

const BLOCK_START = /(?=<!-- comment_id: )/;
const ID_RE = /<!-- comment_id: (\S+) -->/;
const UPDATED_RE = /<!-- updated_at: (\S+) -->/;

export function parseCommentBlocks(content) {
  console.log('[parseCommentBlocks] step 1: regex-matching <!-- comment_id: N --> blocks in existing file content');
  const blocks = {};
  if (!content.includes('<!-- comment_id:')) {
    console.log('[parseCommentBlocks] step 2: no comment_id markers found, returning empty map');
    return blocks;
  }
  const chunks = content.split(BLOCK_START).filter((c) => c.startsWith('<!-- comment_id:'));
  console.log(`[parseCommentBlocks] step 2: split into ${chunks.length} candidate block(s)`);
  for (const chunk of chunks) {
    const idMatch = chunk.match(ID_RE);
    const updatedMatch = chunk.match(UPDATED_RE);
    const block = chunk.replace(/\n+$/, '');
    blocks[idMatch[1]] = {
      id: idMatch[1],
      updatedAt: updatedMatch[1],
      block,
    };
  }
  console.log(`[parseCommentBlocks] step 3: indexed blocks by commentId, keys: ${Object.keys(blocks)}`);
  return blocks;
}

export function mergeComments(existingBlocks, freshComments, downloadedAt) {
  console.log(`[mergeComments] step 1: diffing ${freshComments.length} fresh comments against ${Object.keys(existingBlocks).length} existing blocks`);
  const seen = new Set();
  const result = [];

  for (const comment of freshComments) {
    seen.add(String(comment.id));
    const existing = existingBlocks[comment.id];
    if (!existing) {
      console.log(`[mergeComments] step 2: comment_id=${comment.id} is new -> appending formatted block`);
      result.push(formatComment(comment, downloadedAt));
    } else if (existing.updatedAt !== comment.updated) {
      console.log(`[mergeComments] step 3: comment_id=${comment.id} changed (${existing.updatedAt} -> ${comment.updated}) -> replacing block`);
      result.push(formatComment(comment, downloadedAt));
    } else {
      console.log(`[mergeComments] step 4: comment_id=${comment.id} unchanged -> keeping existing block as-is`);
      result.push(existing.block);
    }
  }

  for (const [id, existing] of Object.entries(existingBlocks)) {
    if (seen.has(id)) continue;
    console.log(`[mergeComments] step 5: comment_id=${id} missing from fresh comments -> marking deleted_at=${downloadedAt}`);
    result.push(`${existing.block}\n<!-- deleted_at: ${downloadedAt} -->`);
  }

  return result;
}
