import j2m from 'j2m';

export function wikiToMarkdown(text) {
  console.log(`[wikiToMarkdown] step 1: converting ${text?.length ?? 0} chars of wiki markup via j2m.toM`);
  if (!text) {
    console.log('[wikiToMarkdown] step 2: empty input, short-circuiting (j2m.toM("") returns a stray "\\n")');
    return '';
  }
  return j2m.toM(text);
}
