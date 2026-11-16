import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Include the actual emitted HTML, CSS, fonts and public assets in one version. */
export function pwa() {
  return {
    name: 'reader-pwa',
    apply: 'build',
    async writeBundle(options) {
      const directory = resolve(options.dir ?? 'dist');
      const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).replaceAll('\\', '/'))
        .filter((name) => name !== 'sw.js' && !name.endsWith('.map'))
        .sort();
      const template = await readFile(new URL('./sw.js', import.meta.url), 'utf8');
      const digest = createHash('sha256').update(template);
      for (const file of files) digest.update(file).update(await readFile(join(directory, file)));
      const version = digest.digest('hex').slice(0, 20);
      const worker = template.replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files));
      await writeFile(join(directory, 'sw.js'), worker);
      const indexPath = join(directory, 'index.html');
      const html = await readFile(indexPath, 'utf8');
      await writeFile(indexPath, html.replaceAll('__READER_WEB_BUILD__', version));
    },
  } satisfies Plugin;
}
