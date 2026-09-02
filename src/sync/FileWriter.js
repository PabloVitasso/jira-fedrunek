import fs from 'node:fs';
import path from 'node:path';

export class FileWriter {
  read(filePath) {
    console.log(`[FileWriter.read] step 1: reading ${filePath}, returning null if missing`);
    if (!fs.existsSync(filePath)) {
      console.log('[FileWriter.read] step 2: file does not exist, returning null');
      return null;
    }
    console.log('[FileWriter.read] step 2: file exists, reading as utf8');
    return fs.readFileSync(filePath, 'utf8');
  }

  write(filePath, content) {
    console.log(`[FileWriter.write] step 1: writing ${content?.length ?? 0} chars to ${filePath}`);
    const dir = path.dirname(filePath);
    console.log(`[FileWriter.write] step 2: ensuring parent directory ${dir} exists`);
    fs.mkdirSync(dir, { recursive: true });
    console.log('[FileWriter.write] step 3: writing file as utf8');
    fs.writeFileSync(filePath, content, 'utf8');
  }
}
