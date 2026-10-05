import { useEffect, useState } from 'react';
import type { AgentState } from '../types';

export function AgentView({ tabId, currentUrl }: { tabId: number; currentUrl?: string }) {
  const [state, setState] = useState<AgentState | null>(null);
  const [goal, setGoal] = useState<string>("Fill out and submit the application");

  useEffect(() => {
    // Initial fetch scoped to tab and url
    chrome.runtime.sendMessage({ action: 'GET_AGENT_STATE', tabId, url: currentUrl }, (response) => {
      if (response && response.state) {
        if (response.state.tabId === tabId && (!response.state.url || !currentUrl || response.state.url === currentUrl)) {
          setState(response.state);
        } else {
          setState(null);
        }
      } else {
        setState(null);
      }
    });

    // Listen for updates
    const listener = (request: any) => {
      if (request.action === 'AGENT_STATE_UPDATE') {
        if (!request.state) {
          setState(null);
          return;
        }
        if (request.state.tabId === tabId && (!request.state.url || !currentUrl || request.state.url === currentUrl)) {
          setState(request.state);
        } else {
          setState(null);
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [tabId, currentUrl]);

  const handleStart = () => {
    setState(null); // Clear previous DONE/ERROR/action state immediately
    chrome.runtime.sendMessage({ 
      action: 'START_AGENT', 
      tabId, 
      goal,
      url: currentUrl 
    });
  };

  const handleStop = () => {
    chrome.runtime.sendMessage({ action: 'STOP_AGENT' });
  };

  const handleConfirm = (approved: boolean) => {
    chrome.runtime.sendMessage({ action: 'CONFIRM_ACTION', approved });
  };

  const isMatching = state && state.tabId === tabId && (!state.url || !currentUrl || state.url === currentUrl);
  const displayState = isMatching ? state : null;

  return (
    <div className="p-3 text-sm flex flex-col gap-4">
      {!displayState || displayState.status === 'IDLE' || displayState.status === 'STOPPED' ? (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Task Goal</label>
            <input 
              type="text" 
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Fill out and submit the application"
              className="w-full text-xs border rounded p-2 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-1.5">
            <button 
              onClick={() => setGoal("Fill out and submit the application")}
              className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded"
            >
              Submit App
            </button>
            <button 
              onClick={() => setGoal("Go to the payment page")}
              className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded"
            >
              Payment Page
            </button>
          </div>
          <button 
            onClick={handleStart}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow text-xs"
          >
            Start Autonomous Task
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-center border-b pb-2">
            <span className="font-bold text-gray-700">Status: <span className="text-blue-600">{displayState.status}</span></span>
            <span className="text-xs text-gray-500">Step {displayState.step} / {displayState.maxSteps}</span>
          </div>

          {displayState.error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded text-xs">
              <strong>Error:</strong> {displayState.error}
            </div>
          )}

          {displayState.currentAction && (
            <div className="bg-gray-800 text-green-400 p-2 rounded text-[10px] overflow-auto max-h-32">
              <pre>{JSON.stringify(displayState.currentAction, null, 2)}</pre>
            </div>
          )}

          {displayState.status === 'WAITING_CONFIRMATION' && (
            <div className="bg-yellow-50 border border-yellow-200 p-3 rounded text-center">
              <p className="text-sm text-yellow-800 font-bold mb-2">Irreversible Action Detected</p>
              <p className="text-xs text-yellow-700 mb-3">Do you approve this action?</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => handleConfirm(true)} className="bg-green-600 text-white px-3 py-1 rounded text-xs font-bold">Approve</button>
                <button onClick={() => handleConfirm(false)} className="bg-red-600 text-white px-3 py-1 rounded text-xs font-bold">Deny</button>
              </div>
            </div>
          )}

          {displayState.status !== 'DONE' && displayState.status !== 'ERROR' && (
            <button 
              onClick={handleStop}
              className="w-full bg-red-100 hover:bg-red-200 text-red-700 font-bold py-2 px-4 rounded mt-2 border border-red-300"
            >
              Stop Agent
            </button>
          )}

          {(displayState.status === 'DONE' || displayState.status === 'ERROR') && (
            <div className="flex flex-col gap-2 mt-2">
              {displayState.status === 'DONE' && (
                <div className="bg-green-50 border border-green-200 text-green-700 p-2 rounded text-center text-sm font-bold">
                  Task Completed Successfully!
                </div>
              )}
              <button 
                onClick={() => setState(null)}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-1.5 px-3 rounded text-xs border"
              >
                Start New Goal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
