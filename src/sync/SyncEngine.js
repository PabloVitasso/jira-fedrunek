import matter from 'gray-matter';
import { buildFrontmatter, buildIssueBody } from '../markdown/MarkdownFormatter.js';
import { parseCommentBlocks, mergeComments } from '../markdown/CommentBlockParser.js';

export class SyncEngine {
  constructor(jiraClient, syncState, fileWriter, options = {}) {
    this.jiraClient = jiraClient;
    this.syncState = syncState;
    this.fileWriter = fileWriter;
    this.now = options.now ?? (() => new Date().toISOString());
    this.pathForKey = options.pathForKey ?? ((key) => `sync/${key}.md`);
  }

  async syncIssue(key) {
    console.log(`[SyncEngine.syncIssue] step 1: fetching issue ${key} via JiraClient.getIssue (comments come back inline on fields.comment.comments)`);
    const issue = await this.jiraClient.getIssue(key);
    const stored = this.syncState.getIssue(key);
    console.log(`[SyncEngine.syncIssue] step 2: comparing fields.updated=${issue.fields.updated} vs stored issue_updated_at=${stored?.issue_updated_at}`);
    if (stored && stored.issue_updated_at === issue.fields.updated) {
      console.log('[SyncEngine.syncIssue] step 3: unchanged, skipping body regen');
      return { status: 'unchanged', key };
    }
    console.log('[SyncEngine.syncIssue] step 4: merging inline comments against existing file blocks');
    const comments = issue.fields.comment?.comments ?? [];
    const filePath = this.pathForKey(key);
    const existingContent = this.fileWriter.read(filePath);
    const downloadedAt = this.now();
    const existingBlocks = existingContent ? parseCommentBlocks(existingContent) : {};
    const commentBlocks = mergeComments(existingBlocks, comments, downloadedAt);
    const frontmatter = buildFrontmatter(issue, downloadedAt);
    const body = buildIssueBody(issue);
    const content = [body, '', '---', '', '## Comments', '', ...commentBlocks].join('\n');
    const markdown = matter.stringify(content, frontmatter);
    console.log(`[SyncEngine.syncIssue] step 5: writing ${filePath} via FileWriter.write and updating SyncState.setIssue/save`);
    this.fileWriter.write(filePath, markdown);
    this.syncState.setIssue(key, {
      issue_updated_at: issue.fields.updated,
      comment_ids: comments.map((c) => String(c.id)),
    });
    this.syncState.save();
    return { status: existingContent ? 'updated' : 'created', key };
  }

  async syncAll(keys) {
    console.log(`[SyncEngine.syncAll] step 1: iterating ${keys?.length ?? 0} issue keys`);
    const results = [];
    for (const key of keys) {
      console.log(`[SyncEngine.syncAll] step 2: calling syncIssue(${key})`);
      results.push(await this.syncIssue(key));
    }
    return results;
  }
}
