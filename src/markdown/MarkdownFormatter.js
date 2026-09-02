import matter from 'gray-matter';

export function buildFrontmatter(issue, downloadedAt) {
  console.log(
    `[buildFrontmatter] step 1: extracting issue_key, issue_id, self, status, issue_updated_at for ${issue?.key}`
  );
  if (!issue?.fields?.updated) {
    console.log('[buildFrontmatter] step 2: fields.updated missing - failing fast');
    throw new Error(`issue ${issue?.key} is missing fields.updated`);
  }
  console.log(
    `[buildFrontmatter] step 3: stamping downloaded_at=${downloadedAt} and sync_version=1`
  );
  return {
    issue_key: issue.key,
    issue_id: issue.id,
    url: issue.self,
    status: issue.fields.status.name,
    downloaded_at: downloadedAt,
    issue_updated_at: issue.fields.updated,
    sync_version: 1,
  };
}

export function buildIssueBody(issue) {
  console.log(`[buildIssueBody] step 1: rendering title heading for ${issue?.key}`);
  const assignee = issue.fields.assignee?.displayName ?? 'Unassigned';
  console.log(
    `[buildIssueBody] step 2: rendering Status/Assignee summary lines (assignee=${assignee})`
  );
  console.log('[buildIssueBody] step 3: description is already Markdown text from MCP, used as-is');
  const description = issue.fields.description ?? '';
  return [
    `# ${issue.key}: ${issue.fields.summary}`,
    '',
    `**Status:** ${issue.fields.status.name}`,
    `**Assignee:** ${assignee}`,
    '',
    '## Description',
    '',
    description,
  ].join('\n');
}

export function formatComment(comment, downloadedAt) {
  console.log(
    `[formatComment] step 1: rendering HTML-comment metadata block for comment_id=${comment.id}`
  );
  console.log(
    `[formatComment] step 2: rendering author/created_at/updated_at header, stamping downloaded_at=${downloadedAt}`
  );
  console.log('[formatComment] step 3: comment body is already Markdown text from MCP, used as-is');
  const body = comment.body ?? '';
  const displayDate = comment.created.slice(0, 16).replace('T', ' ');
  return [
    `<!-- comment_id: ${comment.id} -->`,
    `<!-- author: ${comment.author.name} -->`,
    `<!-- created_at: ${comment.created} -->`,
    `<!-- updated_at: ${comment.updated} -->`,
    `<!-- downloaded_at: ${downloadedAt} -->`,
    '',
    `**${comment.author.displayName}** — ${displayDate}`,
    '',
    body,
    '',
    '---',
  ].join('\n');
}

export function buildMarkdown(issue, comments, downloadedAt) {
  console.log(`[buildMarkdown] step 1: buildFrontmatter for ${issue?.key}`);
  const frontmatter = buildFrontmatter(issue, downloadedAt);
  console.log('[buildMarkdown] step 2: buildIssueBody');
  const body = buildIssueBody(issue);
  console.log(`[buildMarkdown] step 3: formatting ${comments.length} comment blocks`);
  const commentBlocks = comments.map(c => formatComment(c, downloadedAt));
  console.log('[buildMarkdown] step 4: gray-matter stringify(body, frontmatter)');
  const content = [body, '', '---', '', '## Comments', '', ...commentBlocks].join('\n');
  return matter.stringify(content, frontmatter);
}

export function buildPageFrontmatter(page) {
  console.log(
    `[buildPageFrontmatter] step 1: extracting id/title/space/lastModified for page ${page?.id}`
  );
  if (!page?.id || !page?.title) {
    console.log('[buildPageFrontmatter] step 2: id/title missing - failing fast');
    throw new Error(`Confluence page is missing id/title: ${JSON.stringify(page)}`);
  }
  console.log('[buildPageFrontmatter] step 3: returning { id, title, space, lastModified }');
  return {
    id: page.id,
    title: page.title,
    space: page.spaceKey,
    lastModified: page.lastModified,
  };
}

export function buildToc(markdown) {
  console.log('[buildToc] step 1: scanning ##-###### headings to build a linked table of contents');
  const seen = {};
  const lines = [];
  for (const [, hashes, title] of markdown.matchAll(/^(#{2,6})\s+(.+)$/gm)) {
    const depth = hashes.length - 2;
    const anchor = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    seen[anchor] = (seen[anchor] ?? 0) + 1;
    const link = seen[anchor] > 1 ? `${anchor}-${seen[anchor] - 1}` : anchor;
    lines.push(`${'  '.repeat(depth)}- [${title}](#${link})`);
  }
  console.log(`[buildToc] step 2: found ${lines.length} heading(s)`);
  return lines.length ? `## Contents\n\n${lines.join('\n')}\n\n---\n\n` : '';
}
