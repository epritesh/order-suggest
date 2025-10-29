export default function Demo() {
  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            Order Suggestion System Demo
          </h1>
          
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              How It Works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h3 className="font-semibold text-blue-800 mb-2">📊 Data Analysis</h3>
                <p className="text-blue-700 text-sm">
                  Analyzes current stock levels, reorder points, and sales trends to determine optimal order quantities.
                </p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <h3 className="font-semibold text-green-800 mb-2">🎯 Smart Filtering</h3>
                <p className="text-green-700 text-sm">
                  Automatically filters out SKUs starting with 0-, 800-, and 2000- as they are never to be ordered.
                </p>
              </div>
              <div className="bg-yellow-50 p-4 rounded-lg">
                <h3 className="font-semibold text-yellow-800 mb-2">⚡ Priority Scoring</h3>
                <p className="text-yellow-700 text-sm">
                  Assigns high, medium, or low priority based on stock levels and sales trends.
                </p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <h3 className="font-semibold text-purple-800 mb-2">📈 Trend Analysis</h3>
                <p className="text-purple-700 text-sm">
                  Adjusts quantities based on increasing, decreasing, or stable sales trends.
                </p>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Sample Data Processing
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Stock</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reorder Point</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sales Trend</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">ABC-123</td>
                    <td className="px-6 py-4 text-sm text-gray-900">15</td>
                    <td className="px-6 py-4 text-sm text-gray-900">20</td>
                    <td className="px-6 py-4 text-sm text-gray-900">Increasing</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                        High Priority
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">DEF-456</td>
                    <td className="px-6 py-4 text-sm text-gray-900">5</td>
                    <td className="px-6 py-4 text-sm text-gray-900">15</td>
                    <td className="px-6 py-4 text-sm text-gray-900">Stable</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">
                        High Priority
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">0-PROMO</td>
                    <td className="px-6 py-4 text-sm text-gray-900">100</td>
                    <td className="px-6 py-4 text-sm text-gray-900">50</td>
                    <td className="px-6 py-4 text-sm text-gray-900">Stable</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                        Filtered Out
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">800-SERVICE</td>
                    <td className="px-6 py-4 text-sm text-gray-900">0</td>
                    <td className="px-6 py-4 text-sm text-gray-900">0</td>
                    <td className="px-6 py-4 text-sm text-gray-900">Stable</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                        Filtered Out
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6 rounded-lg">
            <h2 className="text-xl font-semibold mb-2">
              Ready for Zoho Integration
            </h2>
            <p className="mb-4">
              This app is designed to work seamlessly with Zoho Inventory as a Slate app.
              It can automatically fetch your inventory data and provide real-time order suggestions.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a 
                href="/"
                className="bg-white text-blue-600 px-4 py-2 rounded font-semibold text-center hover:bg-gray-100 transition-colors"
              >
                View Live Demo
              </a>
              <a 
                href="/api/suggestions"
                className="bg-blue-700 text-white px-4 py-2 rounded font-semibold text-center hover:bg-blue-800 transition-colors"
              >
                API Documentation
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}