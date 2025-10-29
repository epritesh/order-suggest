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
  const [suggestions, setSuggestions] = useState<OrderSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
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
      try {
        const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
        const sug = base.match(/\/suggestions$/) ? base : `${base}/suggestions`;
        const url = `${sug}?live=1&months=6`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ months: 6 })
        });
        if (!resp.ok) throw new Error(`Live fetch failed: ${resp.status}`);
        const data = await resp.json();
        setSuggestions((data && (data.suggestions || data.data || [])) as OrderSuggestion[]);
      } catch (err) {
        setSuggestions([]);
        const msg = err instanceof Error ? err.message : 'Failed to fetch live suggestions';
        setError(msg);
      } finally {
        setLoading(false);
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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Purchase Order Suggestion System
          </h1>
          <p className="text-gray-600">
            AI-powered quantity suggestions based on sales trends and stock levels
          </p>
          <p className="text-sm text-gray-500 mt-1">
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
            <div className="mb-4 p-3 rounded border border-blue-200 bg-blue-50 text-blue-900">
              Using function URL: {functionUrl}
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-red-800">
                {error}
              </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-sm font-medium text-gray-500">Total Items</h3>
                <p className="text-2xl font-bold text-gray-900">{filteredSuggestions.length}</p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-sm font-medium text-gray-500">High Priority</h3>
                <p className="text-2xl font-bold text-red-600">
                  {filteredSuggestions.filter(s => s.priority === 'high').length}
                </p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-sm font-medium text-gray-500">Medium Priority</h3>
                <p className="text-2xl font-bold text-yellow-600">
                  {filteredSuggestions.filter(s => s.priority === 'medium').length}
                </p>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <h3 className="text-sm font-medium text-gray-500">Total Cost</h3>
                <p className="text-2xl font-bold text-green-600">
                  ${totalEstimatedCost.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-white p-4 rounded-lg shadow mb-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Search SKU or Description
                  </label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter SKU or description..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority Filter
                  </label>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      try {
                        if (!functionUrl) throw new Error('Set the Catalyst Function URL to fetch live data.');
                        const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
                        const sug = base.match(/\/suggestions$/) ? base : `${base}/suggestions`;
                        const url = `${sug}?live=1&months=6`;
                        const resp = await fetch(url, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ months: 6 })
                        });
                        if (!resp.ok) throw new Error(`Live fetch failed: ${resp.status}`);
                        const data = await resp.json();
                        setSuggestions((data && (data.suggestions || data.data || [])) as OrderSuggestion[]);
                      } catch (err) {
                        setSuggestions([]);
                        const msg = err instanceof Error ? err.message : 'Failed to fetch live suggestions';
                        setError(msg);
                      } finally {
                        setLoading(false);
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
