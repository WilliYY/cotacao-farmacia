import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { buildWimifarmaPreview } from '../src/lib/wimifarma-preview.js';

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(['report', 'template', 'site', 'output'].map(k => [k, { type: 'string' }])) });
  if (!['report', 'template', 'site', 'output'].every(k => values[k])) throw new Error('Use --report, --template, --site e --output.');
  const site = path.resolve(values.site);
  process.env.TSX_TSCONFIG_PATH = path.join(site, 'tsconfig.json');
  const siteRequire = createRequire(path.join(site, 'package.json'));
  const { require: loadSiteModule } = siteRequire('tsx/cjs/api');
  const { supplierImportManifestSchema } = loadSiteModule(path.join(site, 'src/features/supplier-catalog/import-manifest.ts'), path.join(site, 'package.json'));
  const [report, template] = await Promise.all([values.report, values.template].map(f => fs.readFile(f, 'utf8')));
  const result = buildWimifarmaPreview(JSON.parse(report.replace(/^\uFEFF/, '')), JSON.parse(template.replace(/^\uFEFF/, '')), {
    parseManifest: input => supplierImportManifestSchema.parse(input)
  });
  const sha = input => createHash('sha256').update(input).digest('hex');
  result.inputs = { reportSha256: sha(report), templateSha256: sha(template) };
  await fs.writeFile(values.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(result.counts));
}
main().catch(error => {
  console.error(error.name === 'ZodError' ? 'O validador da loja recusou o manifesto.' : error.message);
  process.exitCode = 1;
});
