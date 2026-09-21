import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Check the emitted references, not only Expo's input configuration. */
export async function verifyMarketExport(directory: string): Promise<void> {
  const html = await readFile(resolve(directory, 'index.html'), 'utf8');
  const resources = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
  if (!resources.some(resource => resource.startsWith('/market/_expo/') && resource.endsWith('.js'))) {
    throw new Error('Market export has no /market JavaScript bundle.');
  }
  for (const resource of resources) {
    if (!resource.startsWith('/market/')) throw new Error('Export resource escapes the /market path.');
    const url = new URL(resource, 'https://databallr.dev');
    if (!url.pathname.startsWith('/market/')) throw new Error('Export resource escapes the /market path.');
    await access(resolve(directory, '.' + url.pathname.slice('/market'.length)));
  }
}
