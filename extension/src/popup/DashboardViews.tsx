import { useEffect, useState } from 'react';
import { metrics } from '../privacy/metrics';
import type { AuditEvent, MetricSummary } from '../privacy/metrics';
import { Download, Activity, Cpu, ShieldCheck, FileCheck } from 'lucide-react';

export function EvalResultsView() {
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    fetch('/eval_results.json')
      .then(res => res.json())
      .then(setResults)
      .catch(console.error);
  }, []);

  if (!results) return <div className="p-4 text-center text-gray-500">Loading eval results...</div>;

  return (
    <div className="p-3 space-y-4 text-xs">
      <div>
        <h3 className="font-bold text-gray-500 uppercase flex items-center gap-1 mb-2">
          <FileCheck className="w-4 h-4" /> E2E Harness Evaluation
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="border p-2 bg-gray-50 rounded">
            <div className="text-gray-500">Visual Context Acc</div>
            <div className="font-bold">{(results.visual_context_accuracy * 100).toFixed(1)}%</div>
          </div>
          <div className="border p-2 bg-gray-50 rounded">
            <div className="text-gray-500">PII F1 Score</div>
            <div className="font-bold">{(results.pii_metrics.f1 * 100).toFixed(1)}%</div>
          </div>
          <div className="border p-2 bg-gray-50 rounded col-span-2">
            <div className="text-gray-500">Redaction (Correct/Over/Missed)</div>
            <div className="font-bold">{results.redaction_precision.correct} / {results.redaction_precision.over_redacted} / {results.redaction_precision.missed}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MetricsView() {
  const [summaries, setSummaries] = useState<MetricSummary[]>([]);
  const [resources, setResources] = useState<any>({});
  const [serverMetrics, setServerMetrics] = useState<any>(null);

  const refreshData = () => {
    metrics.getSummary().then(setSummaries);
    setResources(metrics.getResourceUsage());

    fetch('http://127.0.0.1:8000/metrics')
      .then(res => res.json())
      .then(setServerMetrics)
      .catch(() => {});
  };

  useEffect(() => {
    refreshData();
  }, []);

  const handleClear = async () => {
    await metrics.clearMetricsAndAudit();
    setSummaries([]);
    refreshData();
  };

  return (
    <div className="p-3 space-y-4">
      <div>
        <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1 mb-2">
          <Activity className="w-4 h-4" /> Latency Pipeline (ms)
        </h3>
        <div className="bg-white border rounded shadow-sm overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 text-gray-500 border-b">
              <tr>
                <th className="p-2 font-medium">Stage</th>
                <th className="p-2 font-medium">Median</th>
                <th className="p-2 font-medium">P95</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(s => (
                <tr key={s.stage} className="border-b last:border-0">
                  <td className="p-2 font-medium">{s.stage}</td>
                  <td className="p-2">{Math.round(s.median)}</td>
                  <td className="p-2 text-gray-500">{Math.round(s.p95)}</td>
                </tr>
              ))}
              {summaries.length === 0 && (
                <tr><td colSpan={3} className="p-4 text-center text-gray-400 italic">No metrics collected yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1 mb-2">
          <Cpu className="w-4 h-4" /> Resource Usage
        </h3>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="border rounded p-2 bg-gray-50">
            <div className="text-gray-500 mb-1">Browser JS Heap</div>
            <div className="font-bold">{typeof resources.usedJSHeapSize === 'number' ? resources.usedJSHeapSize.toFixed(1) : 'N/A'} MB</div>
          </div>
          {serverMetrics && (
            <>
              <div className="border rounded p-2 bg-gray-50">
                <div className="text-gray-500 mb-1">Server Process RSS</div>
                <div className="font-bold">{serverMetrics.server_ram_mb ? serverMetrics.server_ram_mb.toFixed(1) : 'N/A'} MB</div>
              </div>
              <div className="border rounded p-2 bg-gray-50">
                <div className="text-gray-500 mb-1">Model in memory</div>
                <div className="font-bold">
                  {serverMetrics.model_in_memory_mb !== null && serverMetrics.model_in_memory_mb !== undefined 
                    ? `${serverMetrics.model_in_memory_mb.toFixed(1)} MB` 
                    : 'null'}
                </div>
              </div>
            </>
          )}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">* Browser memory via performance.memory. For exact total usage, compare with Chrome Task Manager.</p>
      </div>

      <div className="pt-2">
        <button 
          onClick={handleClear}
          className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-1.5 px-3 rounded text-xs font-semibold"
        >
          Clear metrics and audit
        </button>
      </div>
    </div>
  );
}

export function AuditView() {
  const [logs, setLogs] = useState<AuditEvent[]>([]);

  const refreshLogs = () => {
    metrics.getAuditLog().then(setLogs);
  };

  useEffect(() => {
    refreshLogs();
  }, []);

  const handleClear = async () => {
    await metrics.clearMetricsAndAudit();
    setLogs([]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex flex-col gap-2 bg-gray-50">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
            <ShieldCheck className="w-4 h-4" /> Security Audit Log
          </h3>
          <button 
            onClick={handleClear}
            className="text-[10px] text-red-600 hover:text-red-800 font-semibold"
          >
            Clear Log
          </button>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => metrics.exportAuditLog(true)}
            className="flex-1 flex items-center justify-center gap-1 bg-blue-600 text-white text-[10px] px-2 py-1 rounded hover:bg-blue-700"
          >
            <Download className="w-3 h-3" /> Export Session
          </button>
          <button 
            onClick={() => metrics.exportAuditLog(false)}
            className="flex-1 flex items-center justify-center gap-1 bg-gray-800 text-white text-[10px] px-2 py-1 rounded hover:bg-gray-700"
          >
            <Download className="w-3 h-3" /> Export All (Max 100)
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-0 bg-white">
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500 italic text-center p-4">No audit events recorded.</p>
        ) : (
          <ul className="divide-y text-xs">
            {logs.map((log, i) => (
              <li key={i} className="p-3 hover:bg-gray-50">
                <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                  <span className="font-mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="font-bold text-gray-800 mb-1">{log.event}</div>
                <pre className="bg-gray-100 p-1.5 rounded text-[9px] text-gray-600 overflow-x-auto">
                  {JSON.stringify(log.details, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
