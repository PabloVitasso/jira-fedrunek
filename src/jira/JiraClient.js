export const DEFAULT_JIRA_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'description',
  'comment',
  'labels',
  'fixVersions',
  'components',
  'created',
  'updated',
  'resolutiondate',
];

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/;

function textOf(result) {
  return (result?.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

export class JiraClient {
  constructor({ mcpSession, cloudId, fields = DEFAULT_JIRA_FIELDS }) {
    this.mcpSession = mcpSession;
    this.cloudId = cloudId;
    this.fields = fields;
  }

  async getIssue(key, { responseContentFormat = 'markdown' } = {}) {
    if (!ISSUE_KEY_RE.test(key)) {
      console.log(
        `[JiraClient.getIssue] step 1: rejecting key ${JSON.stringify(key)} — does not match Jira issue key format, refusing to interpolate into JQL`
      );
      throw new Error(`invalid Jira issue key: ${key}`);
    }
    console.log(`[JiraClient.getIssue] step 1: searchJiraIssuesUsingJql for key = ${key}`);
    const result = await this.mcpSession.callTool('searchJiraIssuesUsingJql', {
      cloudId: this.cloudId,
      jql: `key = ${key}`,
      fields: this.fields,
      responseContentFormat,
      maxResults: 1,
    });
    console.log(
      '[JiraClient.getIssue] step 2: parsing { issues: [...] } envelope from response text'
    );
    const { issues } = JSON.parse(textOf(result));
    if (issues.length === 0) {
      console.log(`[JiraClient.getIssue] step 3: 0 issues matched key = ${key} — not found`);
      throw new Error(`issue not found: ${key}`);
    }
    if (issues.length > 1) {
      console.log(
        `[JiraClient.getIssue] step 3: ${issues.length} issues matched key = ${key} — invariant violation`
      );
      throw new Error(
        `key = ${key} matched more than one issue (${issues.length}) — this should never happen`
      );
    }
    console.log(`[JiraClient.getIssue] step 3: returning the single matched issue for ${key}`);
    return issues[0];
  }
}
