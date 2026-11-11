import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { validateCatalogs } from './catalog-policy.mjs';
export { validateCatalogs } from './catalog-policy.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = new URL('../site/', import.meta.url);
    const [courses, resources] = await Promise.all(['courses.json', 'resources.json']
      .map(async p => JSON.parse(await readFile(new URL(p, root), 'utf8'))));
    console.log(JSON.stringify(validateCatalogs(courses, resources)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
