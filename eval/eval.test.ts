import { describe, it, expect, beforeEach } from 'vitest';
import { scanDOM } from '../extension/src/content/scanner';
import { sanitizeElement, toWirePayload } from '../extension/src/privacy/sanitizer';
import * as fs from 'fs';
import * as path from 'path';

// ─── helpers ──────────────────────────────────────────────────────────────────

interface GroundTruthSpan {
  text: string;
  category: string;
}

interface GroundTruthNegative {
  text: string;
  reason: string;
}

interface Fixture {
  name: string;
  description: string;
  html: string;
  title: string;
  url: string;
  ground_truth: {
    pii_spans: GroundTruthSpan[];
    negatives?: GroundTruthNegative[];
    sensitive_fields: string[];
    injection_text?: string;
  };
}

function loadFixtures(): Fixture[] {
  const dir = path.join(__dirname, 'fixtures');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

// ─── metrics accumulators ─────────────────────────────────────────────────────

interface PiiResult {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  byCategory: Record<string, { tp: number; fp: number; fn: number }>;
}

interface RedactionResult {
  correctlyRedacted: number;
  overRedacted: number;
  missed: number;
}

interface LatencySample {
  fixture: string;
  scanMs: number;
  sanitizeMs: number;
  wireMs: number;
  totalMs: number;
}

const piiResults: PiiResult = { tp: 0, fp: 0, fn: 0, tn: 0, byCategory: {} };
const redactionResults: RedactionResult = { correctlyRedacted: 0, overRedacted: 0, missed: 0 };
const latencySamples: LatencySample[] = [];

// ─── suite ────────────────────────────────────────────────────────────────────

describe('Evaluation harness', () => {
  const fixtures = loadFixtures();

  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.getBoundingClientRect = () => ({
      width: 100, height: 20, top: 0, left: 0, bottom: 20, right: 100, x: 0, y: 0, toJSON: () => {}
    });
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      get() { return this.textContent || ''; },
      configurable: true
    });
  });

  for (const fixture of fixtures) {
    describe(`Fixture: ${fixture.name}`, () => {
      it('detects and redacts PII correctly', () => {
        document.body.innerHTML = fixture.html;
        document.title = fixture.title;

        // ── scan + sanitize ──────────────────────────────────────────────
        const t0 = performance.now();
        const elements = scanDOM();
        const t1 = performance.now();
        const sanitized = elements.map(el => sanitizeElement(el));
        const t2 = performance.now();
        const payload = toWirePayload({ url: fixture.url, title: fixture.title, elements: sanitized });
        const t3 = performance.now();

        latencySamples.push({
          fixture: fixture.name,
          scanMs: t1 - t0,
          sanitizeMs: t2 - t1,
          wireMs: t3 - t2,
          totalMs: t3 - t0
        });

        const payloadJson = JSON.stringify(payload);

        // ── PII true-positive / false-negative ───────────────────────────
        for (const span of fixture.ground_truth.pii_spans) {
          const leaked = payloadJson.includes(span.text);
          if (!leaked) {
            // Correctly redacted → TP
            piiResults.tp++;
            redactionResults.correctlyRedacted++;
            const cat = span.category;
            if (!piiResults.byCategory[cat]) piiResults.byCategory[cat] = { tp: 0, fp: 0, fn: 0 };
            piiResults.byCategory[cat].tp++;
          } else {
            // Leaked → FN
            piiResults.fn++;
            redactionResults.missed++;
            const cat = span.category;
            if (!piiResults.byCategory[cat]) piiResults.byCategory[cat] = { tp: 0, fp: 0, fn: 0 };
            piiResults.byCategory[cat].fn++;
          }
          expect(payloadJson).not.toContain(span.text);
        }

        // ── false-positive check on negatives ────────────────────────────
        if (fixture.ground_truth.negatives) {
          for (const neg of fixture.ground_truth.negatives) {
            const flaggedAsRedacted = !payloadJson.includes(neg.text);
            if (flaggedAsRedacted) {
              // Over-redacted → FP
              piiResults.fp++;
              redactionResults.overRedacted++;
            } else {
              // Correctly left alone → TN
              piiResults.tn++;
            }
          }
        }

        // ── title must be sanitised if it contains PII ───────────────────
        if (fixture.ground_truth.pii_spans.some(s => fixture.title.includes(s.text))) {
          expect(payload.title).toBe('[TEXT]');
        }

        // ── URL must not leak digits / segments ──────────────────────────
        expect(payload.url).not.toMatch(/\/\d{4,}/); // long numeric path segments should be [SEG]

        // ── input/textarea values must never appear ──────────────────────
        for (const el of payload.elements) {
          if (el.tag === 'input' || el.tag === 'textarea') {
            expect(el.sanitizedText).toMatch(/^\[(FILLED|EMPTY|[A-Z_]+_FILLED)\]$/);
          }
        }
      });

      it('wire payload has no forbidden fields', () => {
        document.body.innerHTML = fixture.html;
        const elements = scanDOM();
        const sanitized = elements.map(el => sanitizeElement(el));
        const payload = toWirePayload({ url: fixture.url, title: fixture.title, elements: sanitized });

        for (const el of payload.elements) {
          expect((el as any).originalText).toBeUndefined();
          expect((el as any).rect).toBeUndefined();
          expect((el as any).text).toBeUndefined();
          expect((el as any).value).toBeUndefined();
          // piiDetected array of objects must not be present, only piiCategories (string[])
          expect((el as any).piiDetected).toBeUndefined();
        }
      });
    });
  }

  // Run 20 latency iterations for the first fixture to get p50/p95
  it('latency benchmark (20 runs)', () => {
    const fix = fixtures[0];
    const samples: number[] = [];

    for (let i = 0; i < 20; i++) {
      document.body.innerHTML = fix.html;
      const t0 = performance.now();
      const elems = scanDOM();
      const sanitized = elems.map(el => sanitizeElement(el));
      toWirePayload({ url: fix.url, title: fix.title, elements: sanitized });
      samples.push(performance.now() - t0);
    }

    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(median).toBeLessThan(500); // sanity: should be well under 500ms
    expect(p95).toBeLessThan(1000);

    // Write final results
    const n = piiResults.tp + piiResults.fn;
    const precision = piiResults.tp / (piiResults.tp + piiResults.fp || 1);
    const recall = piiResults.tp / (piiResults.tp + piiResults.fn || 1);
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    const results = {
      n,
      pii_metrics: {
        tp: piiResults.tp,
        fp: piiResults.fp,
        fn: piiResults.fn,
        tn: piiResults.tn,
        precision: +precision.toFixed(4),
        recall: +recall.toFixed(4),
        f1: +f1.toFixed(4),
        byCategory: piiResults.byCategory
      },
      redaction: {
        correctlyRedacted: redactionResults.correctlyRedacted,
        overRedacted: redactionResults.overRedacted,
        missed: redactionResults.missed
      },
      latency: {
        median_ms: +median.toFixed(2),
        p95_ms: +p95.toFixed(2),
        samples: latencySamples
      }
    };

    fs.writeFileSync(
      path.join(__dirname, 'results.json'),
      JSON.stringify(results, null, 2)
    );

    console.log('\n===== EVALUATION RESULTS =====');
    console.log(`PII  n=${n}  TP=${piiResults.tp}  FP=${piiResults.fp}  FN=${piiResults.fn}  TN=${piiResults.tn}`);
    console.log(`     precision=${precision.toFixed(4)}  recall=${recall.toFixed(4)}  F1=${f1.toFixed(4)}`);
    console.log(`Redaction  correct=${redactionResults.correctlyRedacted}  over=${redactionResults.overRedacted}  missed=${redactionResults.missed}`);
    console.log(`Latency  median=${median.toFixed(2)}ms  p95=${p95.toFixed(2)}ms`);
    console.log('==============================\n');
  });
});
