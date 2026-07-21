import fs from 'node:fs';
import path from 'node:path';

import { processQuoteQuery } from '../src/lib/recommendation.js';
import { analyzeQuoteBatch, INPUT_STATUS } from '../src/lib/search-intelligence.js';

const DEFAULT_TERMS = [
  'losartana 50mg',
  'amitriptilina 25mg',
  'clonazepam 2mg'
];

const DEFAULT_SUPPLIERS = ['ANB', 'Profarma', 'Santa Cruz', 'DM Paraná'];

function getFlag(args, name) {
  const prefix = `--${name}=`;
  const argument = args.find(value => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length).trim() : '';
}

function getTerms(args) {
  const positional = args.filter(value => !value.startsWith('--'));
  return positional.length > 0 ? positional : DEFAULT_TERMS;
}

function getSuppliers(args) {
  const requested = getFlag(args, 'suppliers');
  if (!requested) return DEFAULT_SUPPLIERS;
  const supplierLookup = new Map(DEFAULT_SUPPLIERS.map(name => [name.toLocaleLowerCase('pt-BR'), name]));
  return requested
    .split(',')
    .map(value => supplierLookup.get(value.trim().toLocaleLowerCase('pt-BR')))
    .filter(Boolean);
}

function sanitizeResult(result) {
  return {
    source: result.source,
    supplierProductName: result.supplierProductName,
    ean: result.ean,
    laboratory: result.laboratory,
    dosage: result.dosage,
    presentation: result.presentation,
    packaging: result.packaging,
    quantity: result.quantity,
    price: result.price,
    priceSourceLabel: result.priceSourceLabel,
    liveFailureReason: result.liveFailureReason,
    stStatus: result.stStatus,
    availability: result.availability,
    auditStatus: result.auditStatus,
    auditSummary: result.auditSummary,
    recommendationStatus: result.recommendationStatus,
    isValidOption: result.isValidOption,
    capturedAt: result.capturedAt,
    debugColumns: result.debugColumns
  };
}

export function classifyDiagnosticResults(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const validRows = rows.filter(result => result.isValidOption && Number(result.price) > 0);
  const infrastructureFailure = rows.length > 0 && rows.every(result => result.liveFailureReason);

  if (infrastructureFailure) {
    return {
      status: 'blocked',
      failureReason: rows[0].liveFailureReason,
      infrastructureFailure: true
    };
  }
  if (validRows.length > 0) {
    return { status: 'ok', failureReason: '', infrastructureFailure: false };
  }

  const supplierRows = rows.filter(result => result.source && result.source !== 'N/A');
  if (supplierRows.length === 0) {
    return {
      status: 'not_found',
      failureReason: 'Nenhum produto retornado pelo fornecedor.',
      infrastructureFailure: false
    };
  }

  const reasons = [...new Set(supplierRows
    .map(result => result.ignoreReason || result.auditSummary || result.recommendationStatus)
    .filter(Boolean))]
    .slice(0, 3);
  return {
    status: 'no_valid_option',
    failureReason: `Fornecedor respondeu, mas nenhuma opcao ficou elegivel${reasons.length ? `: ${reasons.join('; ')}` : '.'}`,
    infrastructureFailure: false
  };
}

function writeReport(args, report) {
  const requestedPath = getFlag(args, 'output');
  const outputPath = path.resolve(requestedPath || path.join('logs', 'live-diagnostic-latest.json'));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  return outputPath;
}

export async function runLiveDiagnostic(args = []) {
  let exitCode = 0;
  const blockedSuppliers = new Map();
  const inputTerms = getTerms(args);
  const searchPlans = analyzeQuoteBatch(inputTerms);
  const report = {
    startedAt: new Date().toISOString(),
    connectorMode: process.env.ENABLE_REAL_CONNECTORS === 'true' ? 'real' : 'not-real',
    databasePath: process.env.DATABASE_PATH || 'app-data',
    inputTerms,
    terms: searchPlans.map(plan => plan.searchText),
    suppliers: getSuppliers(args),
    checks: []
  };

  for (const plan of searchPlans) {
    const term = plan.searchText;
    for (const supplier of report.suppliers) {
      const startedAt = Date.now();
      if (plan.status === INPUT_STATUS.NEEDS_INFO) {
        exitCode = 1;
        report.checks.push({
          term,
          originalTerm: plan.originalText,
          supplier,
          status: 'needs_info',
          failureReason: plan.correctionMessage,
          durationMs: 0,
          resultCount: 0,
          validResultCount: 0,
          lowestValidPrice: null,
          results: []
        });
        continue;
      }
      const previousFailure = blockedSuppliers.get(supplier);
      if (previousFailure) {
        console.log(`[DIAGNOSTICO] ${supplier}: ignorando "${term}" devido a falha anterior: ${previousFailure}`);
        report.checks.push({
          term,
          supplier,
          status: 'blocked',
          blockedByPreviousFailure: true,
          failureReason: previousFailure,
          durationMs: 0,
          resultCount: 0,
          validResultCount: 0,
          lowestValidPrice: null,
          results: []
        });
        continue;
      }
      console.log(`[DIAGNOSTICO] ${supplier}: pesquisando "${term}"...`);

      try {
        const quote = await processQuoteQuery(term, [supplier], { parsedQuery: plan.parsed });
        const outcome = classifyDiagnosticResults(quote.results);
        const results = quote.results.map(sanitizeResult);
        const validResults = results.filter(result => result.isValidOption && Number(result.price) > 0);
        if (outcome.infrastructureFailure) {
          blockedSuppliers.set(supplier, outcome.failureReason);
          exitCode = 1;
        }
        report.checks.push({
          term,
          originalTerm: plan.originalText,
          correctionMessage: plan.correctionMessage || undefined,
          supplier,
          status: outcome.status,
          durationMs: Date.now() - startedAt,
          parsed: quote.parsed,
          resultCount: results.length,
          validResultCount: validResults.length,
          failureReason: outcome.failureReason || undefined,
          lowestValidPrice: validResults.length > 0
            ? Math.min(...validResults.map(result => Number(result.price)))
            : null,
          results
        });
      } catch (error) {
        exitCode = 1;
        report.checks.push({
          term,
          supplier,
          status: 'error',
          durationMs: Date.now() - startedAt,
          error: error.message,
          results: []
        });
      }
    }
  }

  report.completedAt = new Date().toISOString();
  const outputPath = writeReport(args, report);
  const okCount = report.checks.filter(check => check.status === 'ok').length;
  console.log(`[DIAGNOSTICO] Concluido: ${okCount}/${report.checks.length} consultas com opcao valida.`);
  console.log(`[DIAGNOSTICO] Relatorio: ${outputPath}`);
  return { report, outputPath, exitCode };
}
