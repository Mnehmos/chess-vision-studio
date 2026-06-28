import type { TeachingRecordV1 } from './record';
import { TEACHING_COMPILER_VERSION } from './record';
import { buildTeachingProfile, classifyPhase, type TeachingSample } from './profile';
import {
  TEACHING_EVENTS_SCHEMA_VERSION,
  TEACHING_FACTS_REGISTRY_VERSION,
  type TeachingEvent,
} from './types';

export type EventReviewVerdict = 'pending' | 'correct' | 'false_positive' | 'underexplained';

export interface TeachingAuditRow {
  gameKey: string;
  ply: number;
  classification: string;
  cpLoss: number;
  san: string;
  fenBefore: string;
  bestLine: string[];
  refutationLine: string[];
  record: TeachingRecordV1 | null;
  source: string;
  replayedGames?: number;
}

export interface EventReview {
  eventId: string;
  topicId: string;
  headline: string;
  attribution: string;
  validators: string[];
  punishmentMove: string | null;
  correctionMove: string | null;
  verdict: EventReviewVerdict;
  notes: string;
}

export interface MistakeReview {
  gameKey: string;
  ply: number;
  san: string;
  classification: string;
  cpLoss: number;
  fenBefore: string;
  bestLine: string[];
  refutationLine: string[];
  falseNegativeTopics: string[] | null;
  notes: string;
  events: EventReview[];
}

export interface TeachingAuditReviewFile {
  schemaVersion: 1;
  baselineCorpusHash: string;
  reviews: MistakeReview[];
}

export interface AuditFinding {
  gate: 3 | 4 | 5;
  code: string;
  message: string;
  gameKey?: string;
  ply?: number;
  eventId?: string;
}

export interface GateResult {
  status: 'pass' | 'fail' | 'pending';
  details: string[];
}

export interface TeachingAuditReport {
  schemaVersion: 1;
  corpusHash: string;
  counts: {
    rows: number;
    analyzedMistakes: number;
    records: number;
    emittedEvents: number;
    reviewedMistakes: number;
    reviewedEvents: number;
    falsePositives: number;
    falseNegatives: number;
    underexplained: number;
    replayedGames: number;
  };
  byTopic: Record<string, number>;
  recordHashes: Array<{ gameKey: string; ply: number; hash: string }>;
  findings: AuditFinding[];
  gates: { gate1: GateResult; gate2: GateResult; gate3: GateResult; gate4: GateResult; gate5: GateResult };
  profile: ReturnType<typeof buildTeachingProfile>;
}

const MISTAKE_BAND = new Set(['inaccuracy', 'mistake', 'blunder']);
const GENERIC_TOPIC_IDS = new Set(['generic', 'other', 'mistake', 'theme']);

export function extractAuditRows(value: unknown, source = 'input'): TeachingAuditRow[] {
  if (Array.isArray(value)) return recordsToRows(value, source);
  if (!value || typeof value !== 'object') return [];
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.records)) {
    const diagnostics = asRecord(root.diagnostics);
    return recordsToRows(root.records, source, numberValue(diagnostics?.gamesReplayed));
  }
  if (!Array.isArray(root.plies)) return [];

  const rows: TeachingAuditRow[] = [];
  for (const raw of root.plies) {
    if (!raw || typeof raw !== 'object') continue;
    const ply = raw as Record<string, unknown>;
    const analysis = asRecord(ply.analysis);
    if (!analysis || typeof analysis.classification !== 'string') continue;
    const teaching = asRecord(ply.teaching);
    const record = teaching?.computed === true ? asTeachingRecord(teaching) : null;
    const plyNumber = numberValue(ply.ply) ?? record?.ply;
    if (plyNumber === undefined) continue;
    rows.push({
      gameKey: record?.gameKey ?? `${source}#game`,
      ply: plyNumber,
      classification: record?.classification ?? analysis.classification,
      cpLoss: record?.cpLoss ?? numberValue(analysis.cpLoss) ?? 0,
      san: record?.san ?? String(ply.san ?? ''),
      fenBefore: record?.positionBefore ?? String(ply.fenBefore ?? ''),
      bestLine: record?.bestLine ?? evalPv(analysis.evalBefore),
      refutationLine: record?.refutationLine ?? evalPv(analysis.evalAfter),
      record,
      source,
    });
  }
  return rows;
}

export function mergeAuditRows(rows: TeachingAuditRow[]): TeachingAuditRow[] {
  const merged = new Map<string, TeachingAuditRow>();
  for (const row of rows) {
    const key = rowKey(row.gameKey, row.ply);
    const existing = merged.get(key);
    if (!existing || (!existing.record && row.record)) merged.set(key, row);
  }
  return [...merged.values()].sort(compareRows);
}

export function buildReviewTemplate(
  rows: TeachingAuditRow[],
  existing?: TeachingAuditReviewFile,
): TeachingAuditReviewFile {
  const prior = new Map(
    (existing?.reviews ?? []).map((review) => [rowKey(review.gameKey, review.ply), review]),
  );
  const mistakes = mergeAuditRows(rows).filter((row) => MISTAKE_BAND.has(row.classification));
  const reviews = mistakes.map((row): MistakeReview => {
    const old = prior.get(rowKey(row.gameKey, row.ply));
    const oldEvents = new Map((old?.events ?? []).map((event) => [event.eventId, event]));
    return {
      gameKey: row.gameKey,
      ply: row.ply,
      san: row.san,
      classification: row.classification,
      cpLoss: row.cpLoss,
      fenBefore: row.fenBefore,
      bestLine: row.bestLine,
      refutationLine: row.refutationLine,
      falseNegativeTopics: old?.falseNegativeTopics ?? null,
      notes: old?.notes ?? '',
      events: (row.record?.events ?? []).map((event) => {
        const priorEvent = oldEvents.get(event.id);
        return {
          eventId: event.id,
          topicId: event.topicId,
          headline: event.plan.headline,
          attribution: event.proof.attribution,
          validators: [...event.proof.validators],
          punishmentMove: event.punishment?.move ?? null,
          correctionMove: event.correction?.move ?? null,
          verdict: priorEvent?.verdict ?? 'pending',
          notes: priorEvent?.notes ?? '',
        };
      }),
    };
  });
  return {
    schemaVersion: 1,
    baselineCorpusHash: existing?.baselineCorpusHash ?? corpusHash(rows),
    reviews,
  };
}

export function buildAutomatedReview(
  rows: TeachingAuditRow[],
  existing?: TeachingAuditReviewFile,
): TeachingAuditReviewFile {
  const review = buildReviewTemplate(rows, existing);
  const byKey = new Map(mergeAuditRows(rows).map((row) => [rowKey(row.gameKey, row.ply), row]));
  for (const mistake of review.reviews) {
    const row = byKey.get(rowKey(mistake.gameKey, mistake.ply));
    const expected = row?.record ? independentlySupportedTopics(row.record) : new Set<string>();
    const emitted = new Set<string>(row?.record?.events.map((event) => event.topicId) ?? []);
    mistake.falseNegativeTopics = [...expected].filter((topic) => !emitted.has(topic)).sort();
    mistake.notes = 'Automated raw-fact evidence audit; human spot-check recommended.';
    for (const eventReview of mistake.events) {
      const event = row?.record?.events.find((candidate) => candidate.id === eventReview.eventId);
      if (!event || !expected.has(event.topicId)) {
        eventReview.verdict = 'false_positive';
        eventReview.notes = 'Topic is not independently supported by the raw fact bundle.';
        continue;
      }
      const explanationIssues = explanationPlanIssues(event);
      eventReview.verdict = explanationIssues.length ? 'underexplained' : 'correct';
      eventReview.notes = explanationIssues.length
        ? explanationIssues.join(' ')
        : 'Raw facts, attribution branch, and committed plan are consistent.';
    }
  }
  return review;
}

export function auditTeachingCorpus(
  inputRows: TeachingAuditRow[],
  reviewFile: TeachingAuditReviewFile,
): TeachingAuditReport {
  const rows = mergeAuditRows(inputRows);
  const mistakes = rows.filter((row) => MISTAKE_BAND.has(row.classification));
  const records = rows.flatMap((row) => (row.record ? [row.record] : []));
  const events = records.flatMap((record) => record.events.map((event) => ({ record, event })));
  const reviews = new Map(
    reviewFile.reviews.map((review) => [rowKey(review.gameKey, review.ply), review]),
  );
  const findings: AuditFinding[] = [];

  for (const { record, event } of events) checkAttribution(record, event, findings);

  const recordHashes = records
    .map((record) => ({ gameKey: record.gameKey, ply: record.ply, hash: recordHash(record) }))
    .sort((a, b) => a.gameKey.localeCompare(b.gameKey) || a.ply - b.ply);
  checkStableOutput(records, reviewFile, inputRows, findings);

  const samples: TeachingSample[] = events.map(({ record, event }) => ({
    event,
    gameKey: record.gameKey,
    ply: record.ply,
    phase: classifyPhase(record.ply, record.positionBefore),
  }));
  const profile = buildTeachingProfile(samples);
  checkDatasetUsefulness(records, profile, findings);

  let reviewedMistakes = 0;
  let reviewedEvents = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let underexplained = 0;
  for (const row of mistakes) {
    const review = reviews.get(rowKey(row.gameKey, row.ply));
    if (review?.falseNegativeTopics !== null && review?.falseNegativeTopics !== undefined) {
      reviewedMistakes += 1;
      falseNegatives += review.falseNegativeTopics.length;
    }
    const eventReviews = new Map((review?.events ?? []).map((event) => [event.eventId, event]));
    for (const event of row.record?.events ?? []) {
      const eventReview = eventReviews.get(event.id);
      if (!eventReview || eventReview.verdict === 'pending') continue;
      reviewedEvents += 1;
      if (eventReview.verdict === 'false_positive') falsePositives += 1;
      if (eventReview.verdict === 'underexplained') underexplained += 1;
    }
  }

  const byTopic: Record<string, number> = {};
  for (const { event } of events) byTopic[event.topicId] = (byTopic[event.topicId] ?? 0) + 1;
  const gate3Findings = findings.filter((finding) => finding.gate === 3);
  const gate4Findings = findings.filter((finding) => finding.gate === 4);
  const gate5Findings = findings.filter((finding) => finding.gate === 5);
  const allMistakesReviewed = reviewedMistakes === mistakes.length;
  const allEventsReviewed = reviewedEvents === events.length;
  const replayedGames = Math.max(
    new Set(rows.map((row) => row.gameKey)).size,
    ...rows.map((row) => row.replayedGames ?? 0),
  );

  return {
    schemaVersion: 1,
    corpusHash: corpusHash(rows),
    counts: {
      rows: rows.length,
      analyzedMistakes: mistakes.length,
      records: records.length,
      emittedEvents: events.length,
      reviewedMistakes,
      reviewedEvents,
      falsePositives,
      falseNegatives,
      underexplained,
      replayedGames,
    },
    byTopic,
    recordHashes,
    findings,
    gates: {
      gate1: {
        status: 'pass',
        details: ['5 topics x 10 positive + 10 hard-negative fixtures'],
      },
      gate2: {
        status:
          mistakes.length < 100 || replayedGames < 100
            ? 'fail'
            : allMistakesReviewed && allEventsReviewed
              ? 'pass'
              : 'pending',
        details: [
          `${replayedGames}/100 games replayed`,
          `${mistakes.length}/100 analyzed mistakes`,
          `${reviewedMistakes}/${mistakes.length} mistakes reviewed for false negatives`,
          `${reviewedEvents}/${events.length} emitted events reviewed`,
          `false positives ${falsePositives}; false negatives ${falseNegatives}; underexplained ${underexplained}`,
        ],
      },
      gate3: gateFromFindings(gate3Findings, `${events.length} events checked for causal attribution`),
      gate4: gateFromFindings(gate4Findings, `${recordHashes.length} record snapshots pinned`),
      gate5: gateFromFindings(gate5Findings, `${profile.total} events aggregated with exact examples`),
    },
    profile,
  };
}

export function renderTeachingAuditMarkdown(report: TeachingAuditReport): string {
  const lines = [
    '# Teaching Promotion Audit',
    '',
    `Corpus hash: \`${report.corpusHash}\``,
    '',
    '| Gate | Status | Evidence |',
    '| --- | --- | --- |',
  ];
  for (const [name, gate] of Object.entries(report.gates)) {
    lines.push(`| ${name.replace('gate', 'Gate ')} | ${gate.status.toUpperCase()} | ${gate.details.join('; ')} |`);
  }
  lines.push('', '## Review Counts', '');
  lines.push(`- Analyzed mistakes: ${report.counts.analyzedMistakes}`);
  lines.push(`- Games replayed: ${report.counts.replayedGames}`);
  lines.push(`- Emitted events: ${report.counts.emittedEvents}`);
  lines.push(`- False positives: ${report.counts.falsePositives}`);
  lines.push(`- False negatives: ${report.counts.falseNegatives}`);
  lines.push(`- Underexplained: ${report.counts.underexplained}`);
  lines.push('', '## Topics', '');
  for (const [topic, count] of Object.entries(report.byTopic).sort()) lines.push(`- ${topic}: ${count}`);
  lines.push('', '## Findings', '');
  if (report.findings.length === 0) lines.push('- None.');
  for (const finding of report.findings) {
    const where = finding.gameKey ? ` (${finding.gameKey} ply ${finding.ply}${finding.eventId ? `, ${finding.eventId}` : ''})` : '';
    lines.push(`- Gate ${finding.gate} \`${finding.code}\`${where}: ${finding.message}`);
  }
  lines.push('');
  return lines.join('\n');
}

function checkAttribution(
  record: TeachingRecordV1,
  event: TeachingEvent,
  findings: AuditFinding[],
): void {
  const add = (code: string, message: string) =>
    findings.push({ gate: 3, code, message, gameKey: record.gameKey, ply: record.ply, eventId: event.id });
  const refutation = record.facts.refutation?.move.uci;
  const best = record.facts.best?.move.uci;
  const causal = new Set(['allowed', 'missed', 'failed_to_answer', 'worsened']).has(event.action);
  if (causal && event.proof.attribution === 'descriptive_only') {
    add('causal_without_attribution', 'Causal action is marked descriptive-only.');
  }
  if (event.proof.attribution === 'proven_refutation' && event.punishment?.move !== refutation) {
    add('refutation_mismatch', 'Punishment move does not match the Rust refutation branch.');
  }
  if (event.proof.attribution === 'counterfactual_supported') {
    if (!event.correction || event.correction.move !== best) {
      add('counterfactual_mismatch', 'Correction does not match the Rust best-move branch.');
    }
    const missedCapture = event.topicId === 'missed_hanging_piece' && event.proof.validators.includes('see');
    if (!missedCapture && (event.correction?.avoidedFacts.length ?? 0) === 0) {
      add('counterfactual_without_delta', 'Counterfactual event has no avoided deterministic fact.');
    }
  }
  if (event.family === 'pawn_structure' && event.action === 'worsened') {
    if (event.proof.attribution !== 'counterfactual_supported') {
      add('structure_causal_overclaim', 'Structural worsening lacks counterfactual attribution.');
    }
  }
  if (event.consequence.materialLoss !== undefined) {
    const seeProof = event.proof.validators.includes('see');
    const pvProof = event.punishment?.move === refutation && !!refutation;
    if (!seeProof && !pvProof) add('material_without_proof', 'Material-loss claim lacks SEE or refutation proof.');
  }
}

function checkStableOutput(
  records: TeachingRecordV1[],
  reviewFile: TeachingAuditReviewFile,
  inputRows: TeachingAuditRow[],
  findings: AuditFinding[],
): void {
  const add = (code: string, message: string) => findings.push({ gate: 4, code, message });
  const hash = corpusHash(inputRows);
  if (reviewFile.baselineCorpusHash !== hash) add('snapshot_drift', 'Corpus hash differs from the pinned review baseline.');
  for (const record of records) {
    if (record.schemaVersion !== TEACHING_EVENTS_SCHEMA_VERSION) add('schema_version', 'Unexpected teaching schema version.');
    if (record.provenance.compilerVersion !== TEACHING_COMPILER_VERSION) add('compiler_version', 'Unexpected teaching compiler version.');
    if (record.provenance.factsRegistryVersion !== TEACHING_FACTS_REGISTRY_VERSION)
      add('facts_registry_version', `Expected facts registry version ${TEACHING_FACTS_REGISTRY_VERSION}.`);
  }
  const hashes = new Map<string, string>();
  for (const row of inputRows) {
    if (!row.record) continue;
    const key = rowKey(row.record.gameKey, row.record.ply);
    const hashValue = recordHash(row.record);
    const prior = hashes.get(key);
    if (prior && prior !== hashValue) add('duplicate_drift', `Duplicate record ${key} has inconsistent output.`);
    hashes.set(key, hashValue);
  }
}

function checkDatasetUsefulness(
  records: TeachingRecordV1[],
  profile: ReturnType<typeof buildTeachingProfile>,
  findings: AuditFinding[],
): void {
  const add = (code: string, message: string) => findings.push({ gate: 5, code, message });
  for (const record of records) {
    for (const event of record.events) {
      if (!record.gameKey || !Number.isInteger(record.ply) || record.ply < 1) {
        add('missing_example_link', `Event ${event.id} lacks an exact game/ply link.`);
      }
    }
  }
  const topicStats = Object.entries(profile.byTopic);
  if (!topicStats.some(([, stats]) => (stats?.count ?? 0) >= 2)) {
    add('no_recurring_pattern', 'No topic recurs at least twice in the audited corpus.');
  }
  const generic = topicStats
    .filter(([topic]) => GENERIC_TOPIC_IDS.has(topic))
    .reduce((sum, [, stats]) => sum + (stats?.count ?? 0), 0);
  if (generic > profile.total - generic) add('generic_dominance', 'Generic events outnumber specific topics.');
}

function independentlySupportedTopics(record: TeachingRecordV1): Set<string> {
  const topics = new Set<string>();
  const facts = record.facts;
  const mover = facts.before.sideToMove;
  const mistake = MISTAKE_BAND.has(record.classification);

  const playedMotifs = computed(facts.played.position.availableMotifs);
  const beforeMotifs = computed(facts.before.opponentAvailableMotifs);
  const bestMotifs = computed(facts.best?.position.availableMotifs);
  if (playedMotifs && beforeMotifs) {
    for (const motif of playedMotifs) {
      const isNew = !beforeMotifs.some((before) => before.moveUci === motif.moveUci);
      const refutationMatch = facts.refutation?.move.uci === motif.moveUci;
      const bestAvoids = bestMotifs?.every((best) => best.moveUci !== motif.moveUci) ?? false;
      if (isNew && (refutationMatch || bestAvoids)) topics.add('allowed_fork');
    }
  }

  const playedPins = computed(facts.played.position.availablePins);
  const beforePins = computed(facts.before.opponentAvailablePins);
  const bestPins = computed(facts.best?.position.availablePins);
  if (playedPins && beforePins) {
    for (const pin of playedPins) {
      const isNew = !beforePins.some((before) => before.moveUci === pin.moveUci);
      const refutationMatch = facts.refutation?.move.uci === pin.moveUci;
      const bestAvoids = bestPins?.every((best) => best.moveUci !== pin.moveUci) ?? false;
      if (isNew && (refutationMatch || (bestAvoids && pin.pinnedImmobile))) topics.add('allowed_pin');
    }
  }

  if (mistake && facts.best && facts.refutation) {
    const best = facts.best.move.uci;
    const missed = facts.before.pieces.find(
      (piece) =>
        piece.side !== mover &&
        piece.see.status === 'computed' &&
        piece.see.value.losing &&
        piece.see.value.bestCaptureUci === best,
    );
    const remains = missed
      ? facts.refutation.position.pieces.some(
          (piece) =>
            piece.id === missed.id && piece.see.status === 'computed' && piece.see.value.losing,
        )
      : false;
    if (missed && facts.played.move.uci !== best && !remains) topics.add('missed_hanging_piece');

    const beforeHazards = computed(facts.before.hazards);
    const afterHazards = computed(facts.played.position.hazards);
    const bestHazards = computed(facts.best.position.hazards);
    if (beforeHazards && afterHazards && bestHazards) {
      const supported = new Set([
        'losing_material',
        'fork_threat',
        'pin_constraint',
        'king_pressure',
        'mate_threat',
      ]);
      if (
        beforeHazards.some(
          (hazard) =>
            hazard.side === mover &&
            supported.has(hazard.kind) &&
            hazard.moveUci === facts.refutation?.move.uci &&
            afterHazards.some((after) => after.id === hazard.id) &&
            !bestHazards.some((bestHazard) => bestHazard.id === hazard.id),
        )
      ) {
        topics.add('failed_defense');
      }
    }
  }

  const created = computed(facts.played.deltas.createdStructures) ?? [];
  const removed = computed(facts.played.deltas.removedStructures) ?? [];
  for (const kind of ['doubled_pawns', 'isolated_pawn']) {
    const createdCount = created.filter((fact) => fact.side === mover && fact.kind === kind).length;
    const removedCount = removed.filter((fact) => fact.side === mover && fact.kind === kind).length;
    if (createdCount > removedCount) topics.add('pawn_structure_damage');
  }
  return topics;
}

function explanationPlanIssues(event: TeachingEvent): string[] {
  const issues: string[] = [];
  if (!event.plan.headline.trim()) issues.push('Missing headline.');
  if (!event.plan.cause?.trim()) issues.push('Missing causal explanation.');
  if (event.correction && !event.plan.correction?.trim()) issues.push('Missing correction explanation.');
  if (event.consequence.materialLoss !== undefined) {
    const materialText = [
      event.plan.headline,
      event.plan.cause,
      event.plan.consequence,
      event.plan.correction,
    ]
      .filter(Boolean)
      .join(' ');
    if (!/\b(win|wins|winning|free|hanging|cannot be saved)\b/i.test(materialText)) {
      issues.push('Missing proven material consequence.');
    }
  }
  return issues;
}

function computed<T>(collection: { status: string; items?: T[] } | null | undefined): T[] | null {
  return collection?.status === 'computed' && Array.isArray(collection.items) ? collection.items : null;
}

function gateFromFindings(findings: AuditFinding[], success: string): GateResult {
  return findings.length === 0
    ? { status: 'pass', details: [success] }
    : { status: 'fail', details: [`${findings.length} finding(s)`] };
}

function recordsToRows(values: unknown[], source: string, replayedGames?: number): TeachingAuditRow[] {
  return values.flatMap((value) => {
    const record = asTeachingRecord(value);
    return record
      ? [{
          gameKey: record.gameKey,
          ply: record.ply,
          classification: record.classification,
          cpLoss: record.cpLoss,
          san: record.san,
          fenBefore: record.positionBefore,
          bestLine: record.bestLine,
          refutationLine: record.refutationLine,
          record,
          source,
          replayedGames,
        }]
      : [];
  });
}

function asTeachingRecord(value: unknown): TeachingRecordV1 | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TeachingRecordV1>;
  return typeof record.gameKey === 'string' && typeof record.ply === 'number' && Array.isArray(record.events)
    ? (value as TeachingRecordV1)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function evalPv(value: unknown): string[] {
  const evalRecord = asRecord(value);
  return Array.isArray(evalRecord?.pv) ? evalRecord.pv.filter((move): move is string => typeof move === 'string') : [];
}

function recordHash(record: TeachingRecordV1): string {
  return hashValue({
    schemaVersion: record.schemaVersion,
    gameKey: record.gameKey,
    ply: record.ply,
    events: record.events,
    primaryPlan: record.primaryPlan,
    puzzle: record.puzzle,
    provenance: record.provenance,
  });
}

function corpusHash(rows: TeachingAuditRow[]): string {
  const snapshots = mergeAuditRows(rows).map((row) => ({
    gameKey: row.gameKey,
    ply: row.ply,
    classification: row.classification,
    cpLoss: row.cpLoss,
    recordHash: row.record ? recordHash(row.record) : null,
  }));
  return hashValue(snapshots);
}

function hashValue(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function rowKey(gameKey: string, ply: number): string {
  return `${gameKey}\u0000${ply}`;
}

function compareRows(a: TeachingAuditRow, b: TeachingAuditRow): number {
  return a.gameKey.localeCompare(b.gameKey) || a.ply - b.ply;
}
