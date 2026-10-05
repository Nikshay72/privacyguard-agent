export interface StageLatency {
  stage: string;
  durationMs: number;
  timestamp: number;
}

export interface MetricSummary {
  stage: string;
  count: number;
  median: number;
  p95: number;
}

export interface AuditEvent {
  timestamp: string;
  event: string;
  details: any;
}

class MetricsTracker {
  async recordLatency(stage: string, durationMs: number) {
    const data = await chrome.storage.local.get({ latencies: [] });
    const latencies = data.latencies as StageLatency[];
    latencies.push({ stage, durationMs, timestamp: Date.now() });
    await chrome.storage.local.set({ latencies });
  }

  async getSummary(): Promise<MetricSummary[]> {
    const data = await chrome.storage.local.get({ latencies: [] });
    const latencies = data.latencies as StageLatency[];
    
    const grouped = latencies.reduce((acc, curr) => {
      if (!acc[curr.stage]) acc[curr.stage] = [];
      acc[curr.stage].push(curr.durationMs);
      return acc;
    }, {} as Record<string, number[]>);

    return Object.keys(grouped).map(stage => {
      const times = grouped[stage].sort((a, b) => a - b);
      const median = times[Math.floor(times.length / 2)];
      const p95 = times[Math.floor(times.length * 0.95)];
      return {
        stage,
        count: times.length,
        median,
        p95: p95 !== undefined ? p95 : median
      };
    });
  }

  async logEvent(event: string, details: any = {}) {
    const cleanDetails = { ...details };
    if (cleanDetails.rawText) cleanDetails.rawText = '[REDACTED]';
    if (cleanDetails.value) cleanDetails.value = '[REDACTED]';

    const data = await chrome.storage.local.get({ auditLog: [] });
    const auditLog = data.auditLog as AuditEvent[];
    auditLog.push({
      timestamp: new Date().toISOString(),
      event,
      details: cleanDetails
    });
    // Keep last 100 events
    if (auditLog.length > 100) auditLog.shift();
    await chrome.storage.local.set({ auditLog });
  }

  async getAuditLog(): Promise<AuditEvent[]> {
    const data = await chrome.storage.local.get({ auditLog: [] });
    return (data.auditLog || []) as AuditEvent[];
  }

  async getCurrentSessionAuditLog(): Promise<AuditEvent[]> {
    const logs = await this.getAuditLog();
    let lastGoalStartIndex = -1;
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].event === 'GOAL_STARTED') {
        lastGoalStartIndex = i;
        break;
      }
    }
    return lastGoalStartIndex !== -1 ? logs.slice(lastGoalStartIndex) : logs;
  }

  async exportAuditLog(currentSessionOnly: boolean = false) {
    const log = currentSessionOnly ? await this.getCurrentSessionAuditLog() : await this.getAuditLog();
    const json = JSON.stringify(log, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    
    // In MV3, download can be initiated via URL if called in a visible page/popup
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const prefix = currentSessionOnly ? 'privacyguard-audit-session' : 'privacyguard-audit-all';
    a.download = `${prefix}-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async clearMetricsAndAudit() {
    await chrome.storage.local.set({ latencies: [], auditLog: [] });
  }

  getResourceUsage() {
    const memory = (performance as any).memory;
    return {
      usedJSHeapSize: memory ? memory.usedJSHeapSize / (1024 * 1024) : 'N/A',
      totalJSHeapSize: memory ? memory.totalJSHeapSize / (1024 * 1024) : 'N/A',
    };
  }
}

export const metrics = new MetricsTracker();
