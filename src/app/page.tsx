'use client';

import { useState, useEffect, useCallback } from 'react';

interface SKUData {
  sku: string;
  description: string;
  currentStock: number;
  reorderPoint: number;
  maxStock: number;
  avgMonthlySales: number;
  lastSale: string;
  lastSupplied: string;
  supplier: string;
  unitCost: number;
  category: string;
  salesTrend: 'increasing' | 'decreasing' | 'stable';
}

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
  const [skuData, setSkuData] = useState<SKUData[]>([]);
  const [suggestions, setSuggestions] = useState<OrderSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  // Resolve Catalyst Function URL at runtime with fallbacks:
  // 1) NEXT_PUBLIC_CATALYST_FUNCTION_URL (build-time)
  // 2) ?functionUrl=... query param (persisted to localStorage)
  // 3) localStorage key 'order_suggest_function_url'
  const [functionUrl, setFunctionUrl] = useState<string | undefined>(
    (process.env.NEXT_PUBLIC_CATALYST_FUNCTION_URL as string | undefined)
  );
  const [functionUrlDraft, setFunctionUrlDraft] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      const fromQuery = url.searchParams.get('functionUrl') || url.searchParams.get('function_url') || url.searchParams.get('fn');
      if (fromQuery && fromQuery.startsWith('http')) {
        localStorage.setItem('order_suggest_function_url', fromQuery);
        setFunctionUrl(fromQuery);
        setFunctionUrlDraft(fromQuery);
        return;
      }
      if (!functionUrl) {
        const fromLS = localStorage.getItem('order_suggest_function_url') || undefined;
        if (fromLS) {
          setFunctionUrl(fromLS);
          setFunctionUrlDraft(fromLS);
        }
      }
    } catch {
      // ignore
    }
  }, [functionUrl]);

  // Filter out SKUs that begin with 0-, 800-, and 2000-
  const filterOrderableSKUs = (data: SKUData[]): SKUData[] => {
    return data.filter(item => {
      const sku = item.sku.toLowerCase();
      return !sku.startsWith('0-') && 
             !sku.startsWith('800-') && 
             !sku.startsWith('2000-');
    });
  };

  // Calculate order suggestions based on sales trend and stock levels
  const calculateOrderSuggestions = useCallback((data: SKUData[]): OrderSuggestion[] => {
    const orderableData = filterOrderableSKUs(data);
    
    return orderableData.map(item => {
      let suggestedQuantity = 0;
      let priority: 'high' | 'medium' | 'low' = 'low';
      let reason = '';
      
      const stockRatio = item.currentStock / item.maxStock;
      const monthlySalesRate = item.avgMonthlySales / 30; // Daily sales rate
      const daysUntilStockout = item.currentStock / Math.max(monthlySalesRate, 0.1);
      
      // Determine priority and quantity based on multiple factors
      if (item.currentStock <= item.reorderPoint) {
        priority = 'high';
        // Calculate quantity to reach optimal stock level (80% of max)
        const targetStock = item.maxStock * 0.8;
        suggestedQuantity = Math.max(0, targetStock - item.currentStock);
        
        if (item.salesTrend === 'increasing') {
          suggestedQuantity *= 1.2; // Increase by 20% for growing demand
          reason = 'Below reorder point with increasing sales trend';
        } else if (item.salesTrend === 'decreasing') {
          suggestedQuantity *= 0.8; // Decrease by 20% for declining demand
          reason = 'Below reorder point but declining sales trend';
        } else {
          reason = 'Below reorder point';
        }
      } else if (stockRatio < 0.3 && item.salesTrend === 'increasing') {
        priority = 'medium';
        const targetStock = item.maxStock * 0.6;
        suggestedQuantity = Math.max(0, targetStock - item.currentStock);
        reason = 'Low stock with increasing demand';
      } else if (daysUntilStockout < 14 && item.avgMonthlySales > 0) {
        priority = 'medium';
        // Order enough for 30 days plus buffer
        suggestedQuantity = Math.max(0, (item.avgMonthlySales * 1.1) - item.currentStock);
        reason = 'Will run out of stock within 2 weeks';
      } else if (stockRatio < 0.2) {
        priority = 'low';
        const targetStock = item.maxStock * 0.4;
        suggestedQuantity = Math.max(0, targetStock - item.currentStock);
        reason = 'Low stock level';
      }

      // Round to reasonable quantities
      suggestedQuantity = Math.round(suggestedQuantity);
      
      return {
        sku: item.sku,
        description: item.description,
        currentStock: item.currentStock,
        suggestedQuantity,
        priority,
        reason,
        estimatedCost: suggestedQuantity * item.unitCost,
        daysUntilStockout: Math.round(daysUntilStockout)
      };
    }).filter(suggestion => suggestion.suggestedQuantity > 0)
      .sort((a, b) => {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });
  }, []);

  useEffect(() => {
    // Mock data for demonstration
    const mockSKUData: SKUData[] = [
      {
        sku: 'GHI-789',
        description: 'Tool C - Professional Grade',
        currentStock: 35,
        reorderPoint: 10,
        maxStock: 50,
        avgMonthlySales: 8,
        lastSale: '2024-10-20',
        lastSupplied: '2024-10-01',
        supplier: 'Tool Masters',
        unitCost: 45.00,
        category: 'Tools',
        salesTrend: 'decreasing'
      },
      {
        sku: '0-PROMO',
        description: 'Promotional Item - Should be filtered',
        currentStock: 100,
        reorderPoint: 50,
        maxStock: 200,
        avgMonthlySales: 30,
        lastSale: '2024-10-28',
        lastSupplied: '2024-10-15',
        supplier: 'Promo Co',
        unitCost: 2.00,
        category: 'Promotional',
        salesTrend: 'stable'
      },
      {
        sku: '800-SERVICE',
        description: 'Service Item - Should be filtered',
        currentStock: 0,
        reorderPoint: 0,
        maxStock: 0,
        avgMonthlySales: 0,
        lastSale: '2024-10-28',
        lastSupplied: '2024-10-15',
        supplier: 'Service Co',
        unitCost: 0,
        category: 'Service',
        salesTrend: 'stable'
      }
    ];

    // Simulate loading data
    setLoading(true);
    setTimeout(() => {
      setSkuData(mockSKUData);
      // If a Catalyst Function URL is provided, fetch from it; otherwise, compute locally
      const init = async () => {
        try {
          if (functionUrl) {
            const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
            const sug = base.match(/\/suggestions$/) ? base : `${base}/suggestions`;
            const url = `${sug}?live=1&months=6`;
            const resp = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ months: 6 })
            });
            const data = await resp.json();
            setSuggestions((data && (data.suggestions || data.data || [])) as OrderSuggestion[]);
          } else {
            setSuggestions(calculateOrderSuggestions(mockSKUData));
          }
        } catch (e) {
          // Fallback to local calculation on error
          setSuggestions(calculateOrderSuggestions(mockSKUData));
        } finally {
          setLoading(false);
        }
      };
      init();
    }, 1000);
  }, [calculateOrderSuggestions, functionUrl]);

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
            {/* Connection Bar */}
            <div className="bg-white p-3 rounded-lg shadow mb-6 flex flex-col md:flex-row md:items-end md:space-x-3 space-y-3 md:space-y-0">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Catalyst Function URL
                </label>
                <input
                  type="url"
                  value={functionUrlDraft}
                  onChange={(e) => setFunctionUrlDraft(e.target.value)}
                  placeholder="https://<domain>/server/order_suggest_function"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {functionUrl ? (
                    <span>Live mode active. Suggestions fetched from function.</span>
                  ) : (
                    <span>No function URL set. Using local calculation.</span>
                  )}
                </p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    if (functionUrlDraft && functionUrlDraft.startsWith('http')) {
                      localStorage.setItem('order_suggest_function_url', functionUrlDraft);
                      setFunctionUrl(functionUrlDraft);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Save URL
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem('order_suggest_function_url');
                    setFunctionUrl(undefined);
                    setFunctionUrlDraft('');
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  Clear
                </button>
              </div>
            </div>

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
                      try {
                        if (functionUrl) {
                          const base = functionUrl.endsWith('/') ? functionUrl.slice(0, -1) : functionUrl;
                          const sug = base.match(/\/suggestions$/) ? base : `${base}/suggestions`;
                          const url = `${sug}?live=1&months=6`;
                          const resp = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ months: 6 })
                          });
                          const data = await resp.json();
                          setSuggestions((data && (data.suggestions || data.data || [])) as OrderSuggestion[]);
                        } else {
                          setSuggestions(calculateOrderSuggestions(skuData));
                        }
                      } catch (e) {
                        setSuggestions(calculateOrderSuggestions(skuData));
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
