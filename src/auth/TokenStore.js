import fs from 'node:fs';
import path from 'node:path';

export class TokenStore {
  constructor(path) {
    this.path = path;
    this.tokens = null;
  }

  load() {
    console.log(`[TokenStore.load] step 1: reading ${this.path}`);
    if (!fs.existsSync(this.path)) {
      console.log('[TokenStore.load] step 2: file missing, returning null');
      this.tokens = null;
      return null;
    }
    console.log('[TokenStore.load] step 2: JSON.parse into in-memory tokens');
    this.tokens = JSON.parse(fs.readFileSync(this.path, 'utf8'));
    return this.tokens;
  }

  save(tokens) {
    console.log(`[TokenStore.save] step 1: writing tokens (access_token, refresh_token, expires_at, cloud_id) to ${this.path}`);
    this.tokens = tokens;
    const dir = path.dirname(this.path);
    console.log(`[TokenStore.save] step 2: ensuring parent directory ${dir} exists`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });
    console.log('[TokenStore.save] step 3: hardening file permissions to 0600 (owner read/write only)');
    fs.chmodSync(this.path, 0o600);
  }

  isExpired() {
    console.log('[TokenStore.isExpired] step 1: comparing stored expires_at against now');
    if (!this.tokens) {
      console.log('[TokenStore.isExpired] step 2: no tokens loaded/saved, treating as expired');
      return true;
    }
    return new Date(this.tokens.expires_at).getTime() <= Date.now();
  }
}
