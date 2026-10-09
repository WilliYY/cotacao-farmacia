import { fuzzyMatch, isValidEAN13, parseSearchQuery } from './parser.js';
import { analyzeQuoteBatch, INPUT_STATUS } from './search-intelligence.js';
import { dosageMatches, packageSizeMatches } from './quote-auditor.js';
import { combinationMatches, presentationsMatch, REFERENCE_BRAND_NAMES, resolveReferenceBrandName } from './pharmaceutical-context.js';

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const hasSiteRowContent = row => Object.values(row?.values || {}).some(value => String(value ?? '').trim());
export const isSiteMissingPrice = value => !String(value ?? '').trim() || /^\*(?:\s*\*)*$/.test(String(value).trim());

function queryQualifiers(query) {
  const parsed = parseSearchQuery(query);
  let name = normalize(parsed.name);
  const brand = [...REFERENCE_BRAND_NAMES.keys()].filter(value => name === value || name.startsWith(`${value} `))
    .sort((a, b) => b.length - a.length)[0];
  if (brand) name = name.slice(brand.length);
  else if (parsed.activeIngredients.length) {
    for (const ingredient of parsed.activeIngredients) name = name.replaceAll(ingredient, ' ');
  } else return [];
  if (/\b(?:caixas?|cx|com)\s*(?:com\s*)?\d+\s*(?:comprimidos?|comp|cpr|cp|capsulas?|caps|unidades?|un)\b/.test(normalize(query))) {
    name = name.replace(/\b(?:caixas?|cx|com)\b/g, ' ');
  }
  return [...new Set(name.replace(/\d+(?:[.,]\d+)?\s*(?:mcg|mg|ml|g|ui)?/g, ' ')
    .split(/[^a-z]+/).filter(token => token.length >= 3 && !['pura', 'puro', 'simples', 'comp', 'cpr', 'caps', 'comprimidos', 'capsulas'].includes(token)))];
}

export function matchesSiteQualifiers(query, offer) {
  const evidence = normalize(`${offer.supplierProductName || offer.name || ''} ${offer.laboratory || ''}`);
  return queryQualifiers(query).every(token => new RegExp(`\\b${token}\\b`).test(evidence));
}

function isFragment(product) {
  const normalized = normalize(product);
  if (/^(?:obs|observacao|falta|ok|teste|apagar|excluir|nada|nenhum)[.!:]?$/.test(normalized)) return true;
  const meaningful = normalized.replace(/\d+(?:[.,]\d+)?/g, ' ')
    .replace(/\b(?:mg|mcg|g|ml|ui|cx|comp|comprimidos?|cpr|cp|capsulas?|caps|un|und|unidades?|gotas?|susp|sol)\b/g, ' ')
    .replace(/[^a-z]/g, '');
  return meaningful.length < 2;
}

function refineQuery(original, refinement, ambiguous) {
  let query = String(refinement || '').trim();
  if (!query) return { query: original };
  if (isValidEAN13(query)) query = `${query} ${original}`;
  const base = parseSearchQuery(original);
  const next = parseSearchQuery(query);
  const brand = resolveReferenceBrandName(base.name);
  const preservesBrand = !brand || normalize(next.name).includes(normalize(base.name));
  const compatible = (!base.ean || next.ean === base.ean) && preservesBrand &&
    queryQualifiers(original).every(token => new RegExp(`\\b${token}\\b`).test(normalize(query))) &&
    (!base.name || (fuzzyMatch(base.name, next.name) && combinationMatches(base.originalTerms, next.originalTerms))) &&
    (ambiguous || !base.dosage || (dosageMatches(base.dosage, next.dosage) && dosageMatches(next.dosage, base.dosage))) &&
    presentationsMatch(base.presentation, next.presentation, { queryText: base.originalTerms, resultText: next.originalTerms }) &&
    packageSizeMatches(base.packageSize, next.packageSize) &&
    (ambiguous || !(base.quantity > 1) || Number(next.quantity) === Number(base.quantity));
  return compatible ? { query } : { reason: 'O ajuste troca o produto, a dose ou a embalagem informada. Corrija a linha no site se deseja outro item.' };
}

export function analyzeSiteRow(row, { learnedAliases = [], refinement = '' } = {}) {
  const product = String(row?.values?.produto ?? '').trim();
  const ean = String(row?.values?.ean ?? '').trim();
  if (!product && !ean) return { rowId: row.id, status: hasSiteRowContent(row) ? 'suspeita' : 'vazia', canSearch: false,
    reason: 'Linha sem produto/EAN. Pode ser um preenchimento antigo incompleto; confira sem apagar automaticamente.' };
  if (!ean && !isValidEAN13(product) && isFragment(product)) return { rowId: row.id, status: 'suspeita', canSearch: false,
    reason: 'Texto isolado sem identidade de produto. Confira se e um resto de preenchimento; a linha foi preservada.' };
  const originalQuery = [ean, product].filter(Boolean).join(' ');
  const plan = analyzeQuoteBatch([originalQuery], { learnedAliases, expandMultiStrengths: false })[0];
  const query = plan?.status === INPUT_STATUS.CORRECTED ? plan.searchText : originalQuery;
  const adjusted = refineQuery(query, refinement, plan?.status === INPUT_STATUS.NEEDS_INFO);
  if (adjusted.reason) return { rowId: row.id, status: 'refinar', canSearch: false, reason: adjusted.reason };
  if (plan?.status === INPUT_STATUS.NEEDS_INFO && !String(refinement).trim()) {
    return { rowId: row.id, status: 'refinar', canSearch: false,
      reason: plan.parsed.refinementSuggestion || plan.correctionMessage };
  }
  const parsed = parseSearchQuery(adjusted.query);
  const incomplete = !parsed.ean && (!parsed.presentation || !(parsed.quantity > 1 || parsed.packageSize) || !parsed.dosage);
  return { rowId: row.id, originalQuery, query: adjusted.query, canSearch: true,
    status: incomplete ? 'refinar' : 'consultar', correction: plan?.correctionMessage || '',
    reason: incomplete ? 'Pode pesquisar candidatos; confirme EAN ou dose, apresentacao e embalagem antes de preencher.' :
      plan?.correctionMessage || 'Descricao suficiente para consultar e auditar.' };
}

export function analyzeSiteRows(snapshot, options = {}) {
  return (snapshot?.rows || []).filter(hasSiteRowContent).map(row => analyzeSiteRow(row, options));
}
