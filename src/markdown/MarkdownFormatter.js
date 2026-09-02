import matter from 'gray-matter';
import { wikiToMarkdown } from './wikiToMarkdown.js';

export function buildFrontmatter(issue, downloadedAt) {
  console.log(`[buildFrontmatter] step 1: extracting issue_key, issue_id, url, status, issue_updated_at for ${issue?.key}`);
  if (!issue?.fields?.updated) {
    console.log('[buildFrontmatter] step 2: fields.updated missing - failing fast');
    throw new Error(`issue ${issue?.key} is missing fields.updated`);
  }
  console.log(`[buildFrontmatter] step 3: stamping downloaded_at=${downloadedAt} and sync_version=1`);
  return {
    issue_key: issue.key,
    issue_id: issue.id,
    url: issue.url,
    status: issue.fields.status.name,
    downloaded_at: downloadedAt,
    issue_updated_at: issue.fields.updated,
    sync_version: 1,
  };
}

export function buildIssueBody(issue) {
  console.log(`[buildIssueBody] step 1: rendering title heading for ${issue?.key}`);
  const assignee = issue.fields.assignee?.displayName ?? 'Unassigned';
  console.log(`[buildIssueBody] step 2: rendering Status/Assignee summary lines (assignee=${assignee})`);
  console.log('[buildIssueBody] step 3: converting description via wikiToMarkdown');
  const description = wikiToMarkdown(issue.fields.description);
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
  console.log(`[formatComment] step 1: rendering HTML-comment metadata block for comment_id=${comment.id}`);
  console.log(`[formatComment] step 2: rendering author/created_at/updated_at header, stamping downloaded_at=${downloadedAt}`);
  console.log('[formatComment] step 3: converting comment body via wikiToMarkdown');
  const body = wikiToMarkdown(comment.body);
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
  const commentBlocks = comments.map((c) => formatComment(c, downloadedAt));
  console.log('[buildMarkdown] step 4: gray-matter stringify(body, frontmatter)');
  const content = [body, '', '---', '', '## Comments', '', ...commentBlocks].join('\n');
  return matter.stringify(content, frontmatter);
}
