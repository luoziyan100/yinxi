#!/usr/bin/env npx tsx
/**
 * Benchmark runner for Yinxi.
 *
 * Usage:
 *   npx tsx benchmark/runner.ts                      # Run all cases
 *   npx tsx benchmark/runner.ts --category basic      # Run one category
 *   npx tsx benchmark/runner.ts --id debug-001        # Run single case
 *   npx tsx benchmark/runner.ts --difficulty easy      # Filter by difficulty
 *   npx tsx benchmark/runner.ts --verbose             # Show tool calls
 *   npx tsx benchmark/runner.ts --model gpt-4.1       # Override model
 */

import chalk from "chalk";
import * as fs from "fs/promises";
import * as path from "path";
import { runCase, loadAgentConfig } from "./harness.js";
import { allCases, getCasesByCategory, getCasesByDifficulty, getCaseById } from "./cases/index.js";
import type { BenchmarkCase, CaseResult, BenchmarkReport } from "./types.js";

// ── Parse CLI args ──

interface RunOptions {
  category?: string;
  difficulty?: string;
  id?: string;
  verbose: boolean;
  model?: string;
  provider?: string;
}

function parseRunArgs(): RunOptions {
  const args = process.argv.slice(2);
  const opts: RunOptions = { verbose: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--category":
      case "-c":
        opts.category = args[++i];
        break;
      case "--difficulty":
      case "-d":
        opts.difficulty = args[++i];
        break;
      case "--id":
        opts.id = args[++i];
        break;
      case "--verbose":
      case "-v":
        opts.verbose = true;
        break;
      case "--model":
      case "-m":
        opts.model = args[++i];
        break;
      case "--provider":
        opts.provider = args[++i];
        break;
    }
  }
  return opts;
}

// ── Report generation ──

function generateReport(
  results: CaseResult[],
  model: string,
  provider: string
): BenchmarkReport {
  const passed = results.filter((r) => r.pass).length;

  // By category
  const byCategory: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0 };
    byCategory[r.category].total++;
    if (r.pass) byCategory[r.category].passed++;
  }

  // By difficulty
  const byDifficulty: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { total: 0, passed: 0 };
    byDifficulty[r.difficulty].total++;
    if (r.pass) byDifficulty[r.difficulty].passed++;
  }

  const totalTokens = results.reduce(
    (acc, r) => ({
      input: acc.input + r.tokens.input,
      output: acc.output + r.tokens.output,
    }),
    { input: 0, output: 0 }
  );

  return {
    model,
    provider,
    timestamp: new Date().toISOString(),
    totalCases: results.length,
    passed,
    failed: results.length - passed,
    passRate: ((passed / results.length) * 100).toFixed(1) + "%",
    totalTokens,
    totalElapsedMs: results.reduce((sum, r) => sum + r.elapsedMs, 0),
    results,
    byCategory,
    byDifficulty,
  };
}

// ── Pretty print ──

function printHeader(model: string, caseCount: number) {
  console.log();
  console.log(chalk.bold("  ┌─────────────────────────────────────────┐"));
  console.log(chalk.bold("  │") + "     Yinxi Benchmark Runner              " + chalk.bold("│"));
  console.log(chalk.bold("  └─────────────────────────────────────────┘"));
  console.log();
  console.log(`  Model:  ${chalk.cyan(model)}`);
  console.log(`  Cases:  ${chalk.cyan(String(caseCount))}`);
  console.log(chalk.dim("  " + "─".repeat(45)));
  console.log();
}

function printCaseResult(result: CaseResult, index: number) {
  const icon = result.pass ? chalk.green("✓") : chalk.red("✗");
  const time = chalk.dim(`${(result.elapsedMs / 1000).toFixed(1)}s`);
  const tokens = chalk.dim(`${(result.tokens.input + result.tokens.output).toLocaleString()} tok`);
  const tools = chalk.dim(`${result.toolCalls} calls`);

  console.log(`  ${icon} ${chalk.bold(result.id.padEnd(12))} ${result.name.padEnd(32)} ${time}  ${tokens}  ${tools}`);

  if (!result.pass) {
    console.log(chalk.red(`    └─ ${result.reason}`));
    if (result.error) {
      console.log(chalk.dim(`       ${result.error.split("\n")[0]}`));
    }
  }
}

function printSummary(report: BenchmarkReport) {
  console.log();
  console.log(chalk.dim("  " + "═".repeat(45)));
  console.log();

  // Overall
  const rateColor = parseFloat(report.passRate) >= 80 ? chalk.green : parseFloat(report.passRate) >= 50 ? chalk.yellow : chalk.red;
  console.log(`  ${chalk.bold("Result:")} ${rateColor(report.passRate)} (${report.passed}/${report.totalCases})`);
  console.log();

  // By category
  console.log(`  ${chalk.bold("By Category")}`);
  for (const [cat, stats] of Object.entries(report.byCategory)) {
    const pct = ((stats.passed / stats.total) * 100).toFixed(0);
    const bar = "█".repeat(stats.passed) + chalk.dim("░".repeat(stats.total - stats.passed));
    console.log(`    ${cat.padEnd(14)} ${bar} ${stats.passed}/${stats.total} (${pct}%)`);
  }
  console.log();

  // By difficulty
  console.log(`  ${chalk.bold("By Difficulty")}`);
  for (const diff of ["easy", "medium", "hard"]) {
    const stats = report.byDifficulty[diff];
    if (!stats) continue;
    const pct = ((stats.passed / stats.total) * 100).toFixed(0);
    console.log(`    ${diff.padEnd(14)} ${stats.passed}/${stats.total} (${pct}%)`);
  }
  console.log();

  // Totals
  const totalTok = (report.totalTokens.input + report.totalTokens.output).toLocaleString();
  const totalTime = (report.totalElapsedMs / 1000).toFixed(1);
  console.log(`  ${chalk.dim("Tokens:")} ${totalTok}  ${chalk.dim("Time:")} ${totalTime}s`);
  console.log();
}

// ── Main ──

async function main() {
  const opts = parseRunArgs();
  const agentConfig = await loadAgentConfig();

  // Override model/provider if specified
  if (opts.model) agentConfig.model = opts.model;
  if (opts.provider) agentConfig.provider = opts.provider as any;

  // Select cases
  let cases: BenchmarkCase[];
  if (opts.id) {
    const c = getCaseById(opts.id);
    if (!c) {
      console.error(`  Case not found: ${opts.id}`);
      process.exit(1);
    }
    cases = [c];
  } else if (opts.category) {
    cases = getCasesByCategory(opts.category);
  } else if (opts.difficulty) {
    cases = getCasesByDifficulty(opts.difficulty);
  } else {
    cases = allCases;
  }

  if (cases.length === 0) {
    console.error("  No cases matched your filters.");
    process.exit(1);
  }

  printHeader(agentConfig.model, cases.length);

  // Run cases sequentially
  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    process.stdout.write(chalk.dim(`  ⏳ [${i + 1}/${cases.length}] ${testCase.id} ${testCase.name}...`));

    const result = await runCase(testCase, agentConfig, { verbose: opts.verbose });
    results.push(result);

    // Clear the "running" line and print result
    process.stdout.write("\r" + " ".repeat(80) + "\r");
    printCaseResult(result, i);
  }

  // Generate and print report
  const report = generateReport(results, agentConfig.model, agentConfig.provider);
  printSummary(report);

  // Save report to file
  const resultsDir = path.join(import.meta.dirname, "results");
  await fs.mkdir(resultsDir, { recursive: true });
  const filename = `${agentConfig.model.replace(/[/\\:]/g, "-")}_${new Date().toISOString().slice(0, 10)}.json`;
  await fs.writeFile(path.join(resultsDir, filename), JSON.stringify(report, null, 2));
  console.log(chalk.dim(`  Report saved: benchmark/results/${filename}`));
  console.log();

  // Exit with failure code if any cases failed
  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
