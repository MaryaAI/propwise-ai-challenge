import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp, EvalCase, login, resetTestDatabase, startRecording } from './harness';
import { case1aExtractionKarim } from './cases/1a-extraction-karim';
import { case1bExtractionFatima } from './cases/1b-extraction-fatima';
import { case2MatchingKarim } from './cases/2-matching-karim';
import { case3NoSuitableLina } from './cases/3-no-suitable-lina';
import { case4AmbiguousDate } from './cases/4-ambiguous-date';
import { case5aInjectionMessageAlex } from './cases/5a-injection-message-alex';
import { case5bInjectionDescriptionMbr1019 } from './cases/5b-injection-description-mbr1019';
import { case6ToolFailure } from './cases/6-tool-failure';
import { case7ToolChoice } from './cases/7-tool-choice';
import { case8NoActionWithoutApproval } from './cases/8-no-action-without-approval';
import { case9DateTomorrowKarim } from './cases/9-date-tomorrow-karim';
import { case10DateAfterWeekendJames } from './cases/10-date-after-weekend-james';
import { case11Isolation } from './cases/11-isolation';
import { case12RentPriya } from './cases/12-rent-priya';
import { case5cInjectionChatMbr1019 } from './cases/5c-injection-chat-mbr1019';
import { case7bToolChoiceChat } from './cases/7b-tool-choice-chat';
import { case13ChatNarrowing } from './cases/13-chat-narrowing';

// Not mockable (see PLAN.md) -- every case below calls the real Anthropic API.
const ALL_CASES: EvalCase[] = [
  case1aExtractionKarim,
  case1bExtractionFatima,
  case2MatchingKarim,
  case3NoSuitableLina,
  case4AmbiguousDate,
  case5aInjectionMessageAlex,
  case5bInjectionDescriptionMbr1019,
  case5cInjectionChatMbr1019,
  case6ToolFailure,
  case7ToolChoice,
  case7bToolChoiceChat,
  case8NoActionWithoutApproval,
  case9DateTomorrowKarim,
  case10DateAfterWeekendJames,
  case11Isolation,
  case12RentPriya,
  case13ChatNarrowing,
];

interface CaseResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

function writeReport(results: CaseResult[]): void {
  const lines: string[] = ['# Eval report', '', `Generated: ${new Date().toISOString()}`, '', '| Case | Category | Result | Duration (ms) |', '| --- | --- | --- | --- |'];
  for (const r of results) {
    lines.push(`| ${r.name} | ${r.category} | ${r.passed ? '✅ pass' : '❌ fail'} | ${r.durationMs} |`);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push('', '## Failures', '');
    for (const r of failed) {
      lines.push(`### ${r.name}`, '', '```', r.error ?? '', '```', '');
    }
  }

  const passCount = results.length - failed.length;
  lines.push('', `**${passCount}/${results.length} passed.**`);
  writeFileSync(join(__dirname, 'REPORT.md'), lines.join('\n'));
}

async function main(): Promise<void> {
  const caseFlagIndex = process.argv.indexOf('--case');
  const onlyName = caseFlagIndex !== -1 ? process.argv[caseFlagIndex + 1] : null;
  const cases = onlyName ? ALL_CASES.filter((c) => c.name === onlyName) : ALL_CASES;
  if (onlyName && cases.length === 0) {
    console.error(`No case named "${onlyName}". Known cases: ${ALL_CASES.map((c) => c.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log('Resetting the test database...');
  resetTestDatabase();

  const app = await createApp();
  const saraToken = await login(app, 'sara@marinabay.test');
  const omarToken = await login(app, 'omar@desertkey.test');
  const ctx = { app, saraToken, omarToken, createApp };

  const tracesDir = join(__dirname, 'traces');
  mkdirSync(tracesDir, { recursive: true });

  const results: CaseResult[] = [];

  for (const evalCase of cases) {
    const startedAt = Date.now();
    console.log(`Running ${evalCase.name}...`);
    // A fresh recorder per case, so a trace file can never contain another case's runs.
    const recorder = startRecording();
    const traceFile = join(tracesDir, `${evalCase.name}.json`);
    try {
      const { trace } = await evalCase.run(ctx);
      writeFileSync(traceFile, JSON.stringify({ trace, runs: recorder.runs }, null, 2));
      const durationMs = Date.now() - startedAt;
      results.push({ name: evalCase.name, category: evalCase.category, passed: true, durationMs });
      console.log(`  PASS (${durationMs}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      writeFileSync(traceFile, JSON.stringify({ error: message, runs: recorder.runs }, null, 2));
      results.push({ name: evalCase.name, category: evalCase.category, passed: false, error: message, durationMs });
      console.log(`  FAIL: ${message}`);
    }
  }

  await app.close();
  writeReport(results);

  console.log(`\n${results.filter((r) => r.passed).length}/${results.length} passed.`);
  process.exitCode = results.some((r) => !r.passed) ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
