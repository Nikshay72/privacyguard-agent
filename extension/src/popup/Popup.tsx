import { useEffect, useState } from 'react';
import { Shield, ShieldAlert, FileJson, LayoutList, Image as ImageIcon, Bot, Activity, ShieldCheck, ExternalLink, AlertTriangle } from 'lucide-react';
import type { UIContext } from '../types';
import { AgentView } from './AgentView';
import { MetricsView, AuditView } from './DashboardViews';
import { checkServerVersion } from '../api/client';

export function Popup() {
  const [context, setContext] = useState<UIContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'summary' | 'json' | 'image' | 'agent' | 'audit' | 'metrics'>('summary');
  const [maskedImage, setMaskedImage] = useState<string | null>(null);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [backendData, setBackendData] = useState<{ backend: string, latencyMs: number } | null>(null);
  const [tabId, setTabId] = useState<number>(0);

  useEffect(() => {
    checkServerVersion().then((res) => {
      if (!res.ok && res.message?.includes("do not match")) {
        setVersionError(res.message);
      }
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
      if (!tabs[0]?.id) {
        setError("No active tab found");
        setLoading(false);
        return;
      }
      
      const tabId = tabs[0].id;
      setTabId(tabId);
      const windowId = tabs[0].windowId;

      chrome.tabs.sendMessage(tabId, { action: 'SCAN_PAGE' }, (response: any) => {
        if (chrome.runtime.lastError) {
          setError("Could not communicate with page. Reload the page.");
          setLoading(false);
          return;
        } 
        
        if (response?.success) {
          setContext(response.context);
          
          // Request background to capture and redact
          chrome.runtime.sendMessage({
            action: 'CAPTURE_AND_REDACT',
            tabId,
            windowId,
            rects: response.piiRects,
            devicePixelRatio: response.devicePixelRatio
          }, (bgResponse) => {
            setLoading(false);
            if (bgResponse?.success) {
              setMaskedImage(bgResponse.maskedDataUrl);
              setOriginalImage(bgResponse.originalDataUrl);
              setBackendData({
                backend: bgResponse.backend,
                latencyMs: bgResponse.latencyMs
              });
            } else {
              console.warn("Screenshot capture failed", bgResponse?.error);
            }
          });
        } else {
          setError(response?.error || "Unknown error");
          setLoading(false);
        }
      });
    });
  }, []);

  if (loading) {
    return <div className="p-4 text-center text-gray-600">Scanning and rendering...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700">
        <ShieldAlert className="w-8 h-8 mb-2 mx-auto text-red-500" />
        <p className="text-center text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (!context) return null;

  const totalElements = context.elements.length;
  let totalPii = 0;
  const piiCounts: Record<string, number> = {};
  
  context.elements.forEach(el => {
    if (el.piiDetected && el.piiDetected.length > 0) {
      el.piiDetected.forEach(det => {
        totalPii++;
        piiCounts[det.category] = (piiCounts[det.category] || 0) + 1;
      });
    }
  });

  const isProtected = true;

  return (
    <div className="flex flex-col h-screen text-gray-800">
      <header className={`p-4 border-b flex items-center justify-between text-white ${isProtected ? 'bg-green-600' : 'bg-gray-600'}`}>
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6" />
          <div>
            <h1 className="font-bold text-lg leading-tight">PrivacyGuard</h1>
            <p className="text-xs opacity-90">{isProtected ? 'Active & Protecting' : 'Inactive'}</p>
          </div>
        </div>
        <button 
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })}
          title="Open Full Dashboard"
          className="p-1 hover:bg-white/20 rounded transition-colors"
        >
          <ExternalLink className="w-5 h-5" />
        </button>
      </header>
      
      {versionError && (
        <div className="bg-red-600 text-white px-3 py-2 text-xs font-semibold flex items-center gap-2 shadow">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{versionError}</span>
        </div>
      )}

      <main className="flex-1 overflow-auto bg-gray-50 p-4">
        <div className="bg-white rounded-lg border shadow-sm p-3 mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Current Page</h2>
          <p className="text-sm truncate font-medium">{context.title}</p>
          <p className="text-xs text-gray-400 truncate">{context.url}</p>
        </div>

        <div className="bg-white rounded-lg border shadow-sm mb-4">
          <div className="flex border-b overflow-x-auto">
            <button 
              className={`flex-none px-3 py-2 text-[10px] font-medium flex items-center justify-center gap-1 ${view === 'summary' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              onClick={() => setView('summary')}
            >
              <LayoutList className="w-3 h-3" /> Summary
            </button>
            <button 
              className={`flex-none px-3 py-2 text-[10px] font-medium flex items-center justify-center gap-1 ${view === 'json' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              onClick={() => setView('json')}
            >
              <FileJson className="w-3 h-3" /> JSON
            </button>
            <button 
              className={`flex-none px-3 py-2 text-[10px] font-medium flex items-center justify-center gap-1 ${view === 'image' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              onClick={() => setView('image')}
            >
              <ImageIcon className="w-3 h-3" /> Vision
            </button>
            <button 
              className={`flex-none px-3 py-2 text-[10px] font-medium flex items-center justify-center gap-1 ${view === 'agent' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              onClick={() => setView('agent')}
            >
              <Bot className="w-3 h-3" /> Agent
            </button>
            <button 
              className={`flex-none px-3 py-2 text-[10px] font-medium flex items-center justify-center gap-1 ${view === 'audit' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              onClick={() => setView('audit')}
            >
              <ShieldCheck className="w-3 h-3" /> Audit
            </button>
            <button 
              className={`flex-none px-3 py-2 text-[10px] font-medium flex items-center justify-center gap-1 ${view === 'metrics' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
              onClick={() => setView('metrics')}
            >
              <Activity className="w-3 h-3" /> Metrics
            </button>
          </div>

          {view === 'summary' && (
            <div className="p-3">
              <div className="grid grid-cols-2 gap-2 mb-4 text-center">
                <div className="bg-blue-50 p-2 rounded">
                  <div className="text-2xl font-bold text-blue-700">{totalElements}</div>
                  <div className="text-xs text-blue-600">Elements</div>
                </div>
                <div className="bg-red-50 p-2 rounded">
                  <div className="text-2xl font-bold text-red-700">{totalPii}</div>
                  <div className="text-xs text-red-600">PII Detections</div>
                </div>
              </div>
              
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Detected Categories</h3>
              {Object.keys(piiCounts).length === 0 ? (
                <p className="text-sm text-gray-500 italic">No sensitive data detected.</p>
              ) : (
                <ul className="space-y-1">
                  {Object.entries(piiCounts).map(([cat, count]) => (
                    <li key={cat} className="flex justify-between items-center text-sm border-b border-gray-100 py-1 last:border-0">
                      <span className="font-medium">{cat}</span>
                      <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded-full">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {view === 'json' && (
            <div className="p-0 bg-gray-900 rounded-b-lg overflow-hidden">
              <pre className="text-[10px] p-3 text-green-400 overflow-auto max-h-64">
                {JSON.stringify(context, null, 2)}
              </pre>
            </div>
          )}

          {view === 'image' && (
            <div className="p-3">
              {backendData && (
                <div className="mb-3 text-[10px] flex justify-between bg-gray-100 p-2 rounded border">
                  <span>Backend: <strong>{backendData.backend}</strong></span>
                  <span>Latency: <strong>{backendData.latencyMs}ms</strong></span>
                </div>
              )}
              {maskedImage && originalImage ? (
                <div className="space-y-4">
                  <div className="border border-red-200 bg-red-50 p-2 rounded">
                    <div className="flex justify-between items-center mb-1 text-red-800">
                      <p className="text-[10px] font-bold uppercase">Original Screenshot</p>
                      <span className="text-[8px] bg-red-200 text-red-900 px-1 py-0.5 rounded font-bold">NEVER SENT TO SERVER</span>
                    </div>
                    <img src={originalImage} alt="Original" className="w-full object-contain max-h-32 opacity-80 mix-blend-multiply" />
                  </div>
                  <div className="border border-green-200 bg-green-50 p-2 rounded">
                    <div className="flex justify-between items-center mb-1 text-green-800">
                      <p className="text-[10px] font-bold uppercase">Redacted Screenshot</p>
                      <span className="text-[8px] bg-green-200 text-green-900 px-1 py-0.5 rounded font-bold">SENT AS CONTEXT</span>
                    </div>
                    <img src={maskedImage} alt="Masked" className="w-full object-contain max-h-48" />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500 italic text-center p-4">Screenshot capture failed or pending.</p>
              )}
            </div>
          )}
          
          {view === 'agent' && tabId !== 0 && (
            <AgentView tabId={tabId} currentUrl={context?.url} />
          )}

          {view === 'audit' && (
            <AuditView />
          )}

          {view === 'metrics' && (
            <MetricsView />
          )}
        </div>
      </main>
    </div>
  );
}
