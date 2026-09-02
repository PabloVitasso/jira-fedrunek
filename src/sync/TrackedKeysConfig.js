import fs from 'node:fs';
import { parse, stringify } from 'smol-toml';

export class TrackedKeysConfig {
  constructor(path) {
    this.path = path;
  }

  load(data) {
    if (data === undefined) {
      console.log(`[TrackedKeysConfig.load] step 1: reading ${this.path}`);
      if (!fs.existsSync(this.path)) {
        console.log('[TrackedKeysConfig.load] step 2: file missing, returning empty tracked_keys');
        return [];
      }
      console.log('[TrackedKeysConfig.load] step 2: parsing TOML via smol-toml');
      data = parse(fs.readFileSync(this.path, 'utf8'));
    } else {
      console.log('[TrackedKeysConfig.load] step 1: using caller-supplied pre-parsed TOML');
    }
    return data.jira?.tracked_keys ?? [];
  }

  add(keys) {
    console.log(`[TrackedKeysConfig.add] step 1: loading full existing TOML before adding ${JSON.stringify(keys)}`);
    const data = fs.existsSync(this.path) ? parse(fs.readFileSync(this.path, 'utf8')) : {};
    const jira = data.jira ?? {};
    const merged = [...(jira.tracked_keys ?? [])];
    for (const key of keys) {
      if (!merged.includes(key)) {
        console.log(`[TrackedKeysConfig.add] step 2: ${key} is new, appending`);
        merged.push(key);
      } else {
        console.log(`[TrackedKeysConfig.add] step 2: ${key} already tracked, skipping`);
      }
    }
    console.log(`[TrackedKeysConfig.add] step 3: writing jira.tracked_keys=${JSON.stringify(merged)} to ${this.path}, preserving other keys`);
    fs.writeFileSync(this.path, stringify({ ...data, jira: { ...jira, tracked_keys: merged } }), 'utf8');
    return merged;
  }
}
