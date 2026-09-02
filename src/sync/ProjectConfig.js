import fs from 'node:fs';
import { parse } from 'smol-toml';

export class ProjectConfig {
  constructor(path) {
    this.path = path;
  }

  load(data) {
    if (data === undefined) {
      console.log(`[ProjectConfig.load] step 1: reading ${this.path}`);
      if (!fs.existsSync(this.path)) {
        console.log('[ProjectConfig.load] step 2: file missing, returning empty defaults');
        return {
          cloudId: undefined,
          confluence: { spaceKeys: [], watchPages: [], watchDirs: [] },
        };
      }
      console.log('[ProjectConfig.load] step 2: parsing TOML via smol-toml');
      data = parse(fs.readFileSync(this.path, 'utf8'));
    } else {
      console.log('[ProjectConfig.load] step 1: using caller-supplied pre-parsed TOML');
    }
    const confluence = data.confluence ?? {};
    console.log('[ProjectConfig.load] step 3: extracting cloud_id and [confluence] targets');
    return {
      cloudId: data.cloud_id,
      confluence: {
        spaceKeys: confluence.space_keys ?? [],
        watchPages: (confluence.watch_pages ?? []).map((p) => ({ id: p.id, label: p.label })),
        watchDirs: (confluence.watch_dirs ?? []).map((d) => ({ folderId: d.folder_id, label: d.label })),
      },
    };
  }
}
