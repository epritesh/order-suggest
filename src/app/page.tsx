'use client';

import { useState, useEffect } from 'react';

// Live data only — no local sample dataset

interface OrderSuggestion {
  sku: string;
  description: string;
  currentStock: number;
  suggestedQuantity: number;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  estimatedCost: number;
  daysUntilStockout: number;
}

export default function OrderSuggestionSystem() {
  interface HealthResponse {
    ok?: boolean;
    tokenOk?: boolean;
    accountsBase?: string;
    inventoryBase?: string;
    booksBase?: string;
    itemsCount?: number;
    provider?: string;
    error?: string;
    detail?: string;
  }
  const [suggestions, setSuggestions] = useState<OrderSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [adminOpen, setAdminOpen] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<number>(0);
  const [autoRunning, setAutoRunning] = useState<boolean>(false);
  const [months, setMonths] = useState<number>(6);
  const ADMIN_TOKEN = (process.env.NEXT_PUBLIC_PRECOMPUTE_ADMIN_TOKEN as string | undefined) || '';
  // Function URL: prefer env, fallback to declared constant
  const DEFAULT_FUNCTION_URL = 'https://ordersuggest-903975067.development.catalystserverless.com/server/order_suggest_function';
  const functionUrl = (process.env.NEXT_PUBLIC_CATALYST_FUNCTION_URL as string | undefined) || DEFAULT_FUNCTION_URL;

  // Fetch live suggestions whenever the function URL is set/changed
  useEffect(() => {
    const fetchLive = async () => {
      if (!functionUrl) {
        setSuggestions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setIsRefreshing(true);
      // naive client-side progress indicator (0 → 90% until completion)
      setProgress(0);
      let p = 0;
      const inc = () => {
        p = Math.min(90, p + Math.max(1, Math.round((90 - p) * 0.08)));
        setProgress(p);
      };
      const progTimer = setInterval(inc, 400);
      // Fire-and-forget health probe
      (async () => {
        try {
          const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
          const healthUrl = `${base}/healthz`;
          const resp = await fetch(healthUrl, { method: 'GET', mode: 'cors', credentials: 'omit', headers: { 'Accept': 'application/json' } });
          if (resp.ok) {
            const data: HealthResponse = await resp.json();
            setHealth(data);
            setHealthError(null);
          } else {
            setHealth(null);
            setHealthError(`Health check failed: ${resp.status}`);
          }
        } catch (e: unknown) {
          setHealth(null);
          const msg = e instanceof Error ? e.message : 'Health check failed';
          setHealthError(msg);
        }
      })();
      try {
        const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
  const sug = base.match(/\/suggestions$/) ? base : `${base}/suggestions`;
  const url = `${sug}?months=6`;
        const resp = await fetch(url, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          headers: { 'Accept': 'application/json' }
        });
        if (!resp.ok) {
          try {
            const err = await resp.json();
            throw new Error(err?.detail || err?.error || `Live fetch failed: ${resp.status}`);
          } catch {
            throw new Error(`Live fetch failed: ${resp.status}`);
          }
        }
        const data = await resp.json();
        if (resp.status === 202) {
          setSuggestions([]);
          setError(data?.message || 'No precomputed suggestions yet. Use the Admin Panel to start precompute.');
        } else {
          setSuggestions((data && (data.suggestions || data.data || [])) as OrderSuggestion[]);
        }
        setProgress(100);
      } catch (err) {
        setSuggestions([]);
        const msg = err instanceof Error ? err.message : 'Failed to fetch live suggestions';
        setError(msg);
      } finally {
        clearInterval(progTimer);
        setLoading(false);
        // allow the bar to linger briefly at 100%
        setTimeout(() => setIsRefreshing(false), 400);
      }
    };
    fetchLive();
  }, [functionUrl]);

  // Filter suggestions based on search and filters
  const filteredSuggestions = suggestions.filter(suggestion => {
    const matchesSearch = suggestion.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         suggestion.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPriority = priorityFilter === '' || suggestion.priority === priorityFilter;
    
    return matchesSearch && matchesPriority;
  });

  const totalEstimatedCost = filteredSuggestions.reduce((sum, item) => sum + item.estimatedCost, 0);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-neutral-100 mb-2">
            Purchase Order Suggestion System
          </h1>
          <p className="text-neutral-300">
            AI-powered quantity suggestions based on sales trends and stock levels
          </p>
          <p className="text-sm text-neutral-400 mt-1">
            * SKUs starting with 0-, 800-, and 2000- are automatically filtered out
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            {/* Connection info */}
            <div className="mb-4 p-3 rounded border border-sky-700 bg-sky-900/30 text-sky-200">
              Using function URL: {functionUrl}
              {health && (
                <div className="mt-2 text-sm grid grid-cols-1 md:grid-cols-2 gap-2">
                  {health.provider && (
                    <div>
                      <span className="font-semibold">Provider:</span> {health.provider}
                    </div>
                  )}
                  <div>
                    <span className="font-semibold">Token:</span> {health.tokenOk ? 'OK' : 'Not OK'}
                  </div>
                  {health.accountsBase && (
                    <div>
                      <span className="font-semibold">Accounts:</span> {health.accountsBase}
                    </div>
                  )}
                  {health.inventoryBase && (
                    <div>
                      <span className="font-semibold">Inventory:</span> {health.inventoryBase}
                    </div>
                  )}
                  {health.booksBase && (
                    <div>
                      <span className="font-semibold">Books:</span> {health.booksBase}
                    </div>
                  )}
                  {typeof health.itemsCount === 'number' && (
                    <div>
                      <span className="font-semibold">Items Probe:</span> {health.itemsCount}
                    </div>
                  )}
                </div>
              )}
              {healthError && (
                <div className="mt-2 text-sm text-red-700">
                  {healthError}
                </div>
              )}
            </div>

            {/* Progress indicator */}
            {isRefreshing && (
              <div className="mb-4 bg-neutral-900 border border-neutral-800 rounded shadow p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-neutral-200">Preparing live suggestions…</div>
                  <div className="text-sm text-neutral-300">{progress}%</div>
                </div>
                <div className="w-full bg-neutral-800 rounded h-2 overflow-hidden">
                  <div className="bg-blue-600 h-2 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="text-xs text-neutral-400 mt-2">This can take a minute on first run while we aggregate sales from Zoho Books.</div>
              </div>
            )}

            {/* Admin Panel */}
            <div className="mb-6 bg-neutral-900 rounded-lg shadow border border-neutral-800">
              <button
                onClick={() => setAdminOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <span className="font-medium text-neutral-100">Admin Panel: Precompute Suggestions</span>
                <span className="text-sm text-neutral-400">{adminOpen ? 'Hide' : 'Show'}</span>
              </button>
              {adminOpen && (
                <div className="px-4 pb-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div>
                      <label className="block text-sm font-medium text-neutral-200 mb-1">Months</label>
                      <input type="number" min={1} max={24} value={months}
                        onChange={(e) => setMonths(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-neutral-100" />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            if (!functionUrl) throw new Error('Function URL missing');
                            const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
                            const url = `${base}/precompute/start`;
                            const resp = await fetch(url, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                ...(ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {})
                              },
                              body: JSON.stringify({ months })
                            });
                            const data = await resp.json();
                            if (!resp.ok) throw new Error(data?.error || 'Failed to start precompute');
                            setJobId(data.job_id);
                            setJobStatus('queued');
                            setJobProgress(0);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Failed to start precompute');
                          }
                        }}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                      >Start Precompute</button>
                      <button
                        onClick={async () => {
                          if (!jobId) { setError('Start a job first'); return; }
                          try {
                            if (!functionUrl) throw new Error('Function URL missing');
                            const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
                            const url = `${base}/precompute/run?job_id=${encodeURIComponent(jobId)}`;
                            const resp = await fetch(url, { method: 'POST', headers: { ...(ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {}) } });
                            const data = await resp.json();
                            if (!resp.ok) throw new Error(data?.error || 'Run failed');
                            setJobStatus(data.status);
                            setJobProgress(Number(data.progress || 0));
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Failed to run precompute');
                          }
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                      >Run Chunk</button>
                      <button
                        onClick={async () => {
                          if (!jobId) { setError('Start a job first'); return; }
                          setAutoRunning(true);
                          try {
                            const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
                            while (true) {
                              const runUrl = `${base}/precompute/run?job_id=${encodeURIComponent(jobId)}`;
                              const resp = await fetch(runUrl, { method: 'POST', headers: { ...(ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {}) } });
                              const data = await resp.json();
                              if (!resp.ok) throw new Error(data?.error || 'Run failed');
                              setJobStatus(data.status);
                              setJobProgress(Number(data.progress || 0));
                              if (data.status === 'done' || Number(data.progress || 0) >= 100) break;
                              await new Promise(r => setTimeout(r, 1500));
                            }
                            // Refresh suggestions upon completion
                            setIsRefreshing(true);
                            setProgress(0);
                            const sugUrl = `${base}/suggestions?months=${months}`;
                            const sresp = await fetch(sugUrl, { headers: { 'Accept': 'application/json' } });
                            const sdata = await sresp.json();
                            setSuggestions((sdata && (sdata.suggestions || sdata.data || [])) as OrderSuggestion[]);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Failed to auto precompute');
                          } finally {
                            setAutoRunning(false);
                            setIsRefreshing(false);
                          }
                        }}
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                        disabled={!jobId || autoRunning}
                      >Auto Run Until Done</button>
                    </div>
                  </div>
                  {jobId && (
                    <div className="mt-4">
                      <div className="text-sm text-gray-700">Job: <span className="font-mono">{jobId}</span> — Status: <span className="font-semibold">{jobStatus || 'unknown'}</span></div>
                      <div className="w-full bg-gray-100 rounded h-2 mt-2 overflow-hidden">
                        <div className="bg-indigo-600 h-2 transition-all" style={{ width: `${jobProgress}%` }} />
                      </div>
                    </div>
                  )}
                  {ADMIN_TOKEN && (
                    <div className="mt-2 text-xs text-gray-500">Admin token header attached.</div>
                  )}
                </div>
              )}
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-4 p-3 rounded border border-red-800 bg-red-950/40 text-red-200">
                {error}
              </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-lg shadow">
                <h3 className="text-sm font-medium text-neutral-400">Total Items</h3>
                <p className="text-2xl font-bold text-neutral-100">{filteredSuggestions.length}</p>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-lg shadow">
                <h3 className="text-sm font-medium text-neutral-400">High Priority</h3>
                <p className="text-2xl font-bold text-red-600">
                  {filteredSuggestions.filter(s => s.priority === 'high').length}
                </p>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-lg shadow">
                <h3 className="text-sm font-medium text-neutral-400">Medium Priority</h3>
                <p className="text-2xl font-bold text-yellow-600">
                  {filteredSuggestions.filter(s => s.priority === 'medium').length}
                </p>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-lg shadow">
                <h3 className="text-sm font-medium text-neutral-400">Total Cost</h3>
                <p className="text-2xl font-bold text-green-600">
                  ${totalEstimatedCost.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-lg shadow mb-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-200 mb-1">
                    Search SKU or Description
                  </label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter SKU or description..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-200 mb-1">
                    Priority Filter
                  </label>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Priorities</option>
                    <option value="high">High Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="low">Low Priority</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={async () => {
                      setLoading(true);
                      setError(null);
                      setIsRefreshing(true);
                      setProgress(0);
                      let p = 0;
                      const inc = () => {
                        p = Math.min(90, p + Math.max(1, Math.round((90 - p) * 0.08)));
                        setProgress(p);
                      };
                      const progTimer = setInterval(inc, 400);
                      try {
                        if (!functionUrl) throw new Error('Set the Catalyst Function URL to fetch live data.');
                        const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
                        const sug = base.match(/\/suggestions$/) ? base : `${base}/suggestions`;
                        const url = `${sug}?months=6`;
                        const resp = await fetch(url, {
                          method: 'GET',
                          mode: 'cors',
                          credentials: 'omit',
                          headers: { 'Accept': 'application/json' }
                        });
                        if (!resp.ok) {
                          try {
                            const err = await resp.json();
                            throw new Error(err?.detail || err?.error || `Live fetch failed: ${resp.status}`);
                          } catch {
                            throw new Error(`Live fetch failed: ${resp.status}`);
                          }
                        }
                        const data = await resp.json();
                        if (resp.status === 202) {
                          setSuggestions([]);
                          setError(data?.message || 'No precomputed suggestions yet. Use the Admin Panel to start precompute.');
                        } else {
                          setSuggestions((data && (data.suggestions || data.data || [])) as OrderSuggestion[]);
                        }
                        setProgress(100);
                      } catch (err) {
                        setSuggestions([]);
                        const msg = err instanceof Error ? err.message : 'Failed to fetch live suggestions';
                        setError(msg);
                      } finally {
                        clearInterval(progTimer);
                        setLoading(false);
                        setTimeout(() => setIsRefreshing(false), 400);
                      }
                    }}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    Refresh Suggestions
                  </button>
                </div>
              </div>
            </div>

            {/* Suggestions Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900">Order Suggestions</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        SKU
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Description
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Current Stock
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Suggested Qty
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Priority
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Estimated Cost
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Days Until Stockout
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredSuggestions.map((suggestion, index) => (
                      <tr key={suggestion.sku} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {suggestion.sku}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {suggestion.description}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {suggestion.currentStock}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600">
                          {suggestion.suggestedQuantity}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getPriorityColor(suggestion.priority)}`}>
                            {suggestion.priority.charAt(0).toUpperCase() + suggestion.priority.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          ${suggestion.estimatedCost.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {suggestion.daysUntilStockout === Infinity ? 'N/A' : suggestion.daysUntilStockout}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {suggestion.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredSuggestions.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    No order suggestions found matching your criteria.
                  </div>
                )}
              </div>
            </div>

            {/* Export Options */}
            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  const csvContent = "data:text/csv;charset=utf-8," + 
                    "SKU,Description,Current Stock,Suggested Quantity,Priority,Estimated Cost,Days Until Stockout,Reason\n" +
                    filteredSuggestions.map(s => 
                      `"${s.sku}","${s.description}",${s.currentStock},${s.suggestedQuantity},"${s.priority}",${s.estimatedCost.toFixed(2)},${s.daysUntilStockout === Infinity ? 'N/A' : s.daysUntilStockout},"${s.reason}"`
                    ).join("\n");
                  
                  const encodedUri = encodeURI(csvContent);
                  const link = document.createElement("a");
                  link.setAttribute("href", encodedUri);
                  link.setAttribute("download", "order_suggestions.csv");
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                Export CSV
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
