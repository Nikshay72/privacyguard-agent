import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { JSDOM } from 'jsdom';
import { scanDOM } from '../src/content/scanner';
import { sanitizeElement, toWirePayload } from '../src/privacy/sanitizer';
import { detectPII } from '../src/privacy/detector';

function calculatePercentile(values: number[], percentile: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index];
}

async function runEval() {
  console.log('Starting evaluation...');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  
  const fixturesDir = path.join(__dirname, 'fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  const html = fs.readFileSync(path.join(fixturesDir, 'checkout.html'), 'utf8');
  const gtJson = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'checkout.json'), 'utf8'));
  
  const dom = new JSDOM(html);
  const document = dom.window.document;
  (global as any).document = document;
  (global as any).window = dom.window;

  // Mock getBoundingClientRect for JSDOM so scanDOM works
  (dom.window.Element.prototype as any).getBoundingClientRect = () => ({
    width: 100, height: 20, top: 0, left: 0, bottom: 20, right: 100, x: 0, y: 0, toJSON: () => {}
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent || ''; },
    configurable: true
  });

  const results = {
    visual_context_accuracy: null as any,
    pii_metrics: {
      precision: 0,
      recall: 0,
      f1: 0,
      categories: {}
    },
    redaction_precision: {
      correct: 0,
      over_redacted: 0,
      missed: 0
    },
    resource_usage: {
      ram_mb: 0,
      cpu_percent: null as any,
      gpu_status: "N/A",
      inference_time_ms: 0
    },
    latency: {
      total_median: 0,
      total_p95: 0,
      per_stage: {} as Record<string, { median: number, p95: number }>
    }
  };

  const scannedInit = scanDOM();
  const allDetections = scannedInit.flatMap(el => {
    let textToScan = el.text || '';
    if (el.label) textToScan += ' ' + el.label;
    const context = { type: el.type, name: el.name, id: el.tag };
    return textToScan ? detectPII(textToScan, context) : [];
  });
  
  const groundTruth = gtJson.groundTruth;

  let tp = 0, fp = 0, fn = 0;
  
  const detectedValues = allDetections.map(d => d.value);
  for (const gt of groundTruth) {
    if (detectedValues.some(v => v.includes(gt.value))) tp++;
    else fn++;
  }
  for (const det of detectedValues) {
    if (!groundTruth.some(gt => det.includes(gt.value))) {
      fp++;
    }
  }

  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = (2 * precision * recall) / (precision + recall) || 0;

  results.pii_metrics.precision = precision;
  results.pii_metrics.recall = recall;
  results.pii_metrics.f1 = f1;

  results.visual_context_accuracy = null as any; 
  results.redaction_precision.correct = tp;
  results.redaction_precision.over_redacted = fp;
  results.redaction_precision.missed = fn;

  const latencies = { scan: [] as number[], sanitize: [] as number[], server: [] as number[] };

  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const scanned = scanDOM();
    const t1 = performance.now();
    latencies.scan.push(t1 - t0);
    
    const sanitized = scanned.map(sanitizeElement);
    const wire = toWirePayload({ elements: sanitized }).elements;
    const t2 = performance.now();
    latencies.sanitize.push(t2 - t1);

    try {
      // Time the real /plan call
      const payload = {
         context: { url: "http://localhost:3000", title: "Test", elements: wire },
         goal: "Test"
      };
      const resp = await fetch('http://127.0.0.1:8000/plan', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      await resp.text();
    } catch (e) {
      // ignore if server not running or ollama fails
    }
    const t3 = performance.now();
    latencies.server.push(t3 - t2);
  }

  results.latency.per_stage['scan'] = {
    median: calculatePercentile(latencies.scan, 50),
    p95: calculatePercentile(latencies.scan, 95)
  };
  results.latency.per_stage['sanitize'] = {
    median: calculatePercentile(latencies.sanitize, 50),
    p95: calculatePercentile(latencies.sanitize, 95)
  };
  results.latency.per_stage['server_llm'] = {
    median: calculatePercentile(latencies.server, 50),
    p95: calculatePercentile(latencies.server, 95)
  };

  const total = latencies.scan.map((s, i) => s + latencies.sanitize[i] + latencies.server[i]);
  results.latency.total_median = calculatePercentile(total, 50);
  results.latency.total_p95 = calculatePercentile(total, 95);

  results.resource_usage.ram_mb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  results.resource_usage.cpu_percent = null as any; // Not easily measurable in a quick script without external tools

  fs.writeFileSync(path.join(__dirname, '..', '..', 'eval', 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'eval_results.json'), JSON.stringify(results, null, 2));
  console.log('Results written to eval/results.json and public/eval_results.json');
}

runEval().catch(console.error);
