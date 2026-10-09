/**
 * Dry-run of the OpenAI extraction on one or more stored reports, or a local
 * file (for testing against a report that isn't in S3 yet). No DB writes —
 * just prints tokens/cost/shape so you can sanity-check a prompt change or
 * model switch before letting the consumer touch real data.
 *
 *   npx ts-node scripts/vh-extract-sample.ts <s3Key...> [--model gpt-4o]
 *   npx ts-node scripts/vh-extract-sample.ts --file /path/to/report.html [--model gpt-4o]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { S3Service } from '@htownautos/common';
import { extractReport, validateReport, computeCostUsd } from '@htownautos/vehicle-history';

function contentTypeFor(filename: string): string {
  return filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/html';
}

async function runOne(label: string, body: Buffer, contentType: string, model: string | undefined): Promise<void> {
  const result = await extractReport({ body, contentType, vin: null, model });
  const cost = computeCostUsd(result.model, result.usage);
  const errors = result.report ? validateReport(result.report) : [];

  console.log(`\n=== ${label} ===`);
  console.log(`model: ${result.model}  inputMode: ${result.inputMode}  inputChars: ${result.inputChars}  truncated: ${result.truncated}`);
  console.log(`latencyMs: ${result.latencyMs}  isReport: ${result.isReport}`);
  console.log(
    `tokens: prompt=${result.usage.promptTokens} cached=${result.usage.cachedTokens} completion=${result.usage.completionTokens}`,
  );
  console.log(`cost: $${cost === null ? 'unknown (no pricing for model)' : cost.toFixed(6)}`);
  if (errors.length) console.log(`validation errors: ${errors.join('; ')}`);
  const rows = result.report ? result.report.owners_history.reduce((n, o) => n + o.history_table.length, 0) : 0;
  console.log(`owners_history: ${result.report?.owners_history.length ?? 0}  history_table rows: ${rows}`);
  if (result.report) {
    console.log(
      `top-level: millage=${result.report.millage} accident=${result.report.accident} title=${result.report.title} value=${result.report.value}`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf('--model');
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const fileIdx = args.indexOf('--file');

  if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1];
    const body = fs.readFileSync(filePath);
    await runOne(path.basename(filePath), body, contentTypeFor(filePath), model);
    return;
  }

  const s3Keys = args.filter((a, i) => a !== model && args[i - 1] !== '--model' && a !== '--model');
  if (s3Keys.length === 0) {
    console.error('Usage: vh-extract-sample.ts <s3Key...> [--model X]  OR  --file <path> [--model X]');
    process.exit(1);
  }

  const s3 = new S3Service();
  for (const s3Key of s3Keys) {
    const body = await s3.downloadBuffer(s3Key);
    await runOne(s3Key, body, contentTypeFor(s3Key), model);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
