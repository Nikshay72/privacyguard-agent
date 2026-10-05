import React from 'react';
import { createRoot } from 'react-dom/client';
import { MetricsView, AuditView, EvalResultsView } from './popup/DashboardViews';
import { Shield } from 'lucide-react';
import './index.css';

function DashboardFullPage() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3 text-green-700 pb-4 border-b">
        <Shield className="w-8 h-8" />
        <div>
          <h1 className="text-2xl font-bold">PrivacyGuard Dashboard</h1>
          <p className="text-sm text-gray-600">Full system metrics and audit log</p>
        </div>
      </header>

      <div className="bg-white rounded-lg shadow-sm border p-4">
        <EvalResultsView />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden flex flex-col h-[600px]">
          <AuditView />
        </div>
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <MetricsView />
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <DashboardFullPage />
    </React.StrictMode>
  );
}
