/* eslint-disable */
const express = require('express');
const cors = require('cors');
const catalyst = require('zcatalyst-sdk-node');

const app = express();
app.use(express.json());

// CORS: allow local dev and configured origin
const allowedOrigin = process.env.ALLOWED_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || '*';
app.use(cors({ origin: allowedOrigin, credentials: true }));
// Preflight support for browsers
app.options('*', cors({ origin: allowedOrigin, credentials: true }));

// Health check
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'order-suggestions', time: new Date().toISOString() });
});

// Helper: filter SKUs starting with 0-, 800-, 2000-
function filterOrderableSKUs(data) {
  if (!Array.isArray(data)) return [];
  return data.filter(item => {
    const sku = String(item.sku || '').toLowerCase();
    return !sku.startsWith('0-') && !sku.startsWith('800-') && !sku.startsWith('2000-');
  });
}

function calculateOrderSuggestions(data) {
  const orderableData = filterOrderableSKUs(data);

  const suggestions = orderableData.map(item => {
    const currentStock = Number(item.currentStock || 0);
    const reorderPoint = Number(item.reorderPoint || 0);
    const maxStock = Math.max(1, Number(item.maxStock || 100));
    const avgMonthlySales = Math.max(0, Number(item.avgMonthlySales || 0));
    const unitCost = Number(item.unitCost || 0);
    const salesTrend = item.salesTrend || 'stable';

    let suggestedQuantity = 0;
    let priority = 'low';
    let reason = '';

    const stockRatio = currentStock / maxStock;
    const monthlySalesRate = avgMonthlySales / 30; // daily rate
    const daysUntilStockout = monthlySalesRate > 0 ? currentStock / monthlySalesRate : Infinity;

    if (currentStock <= reorderPoint) {
      priority = 'high';
      const targetStock = maxStock * 0.8;
      suggestedQuantity = Math.max(0, targetStock - currentStock);
      if (salesTrend === 'increasing') {
        suggestedQuantity *= 1.2;
        reason = 'Below reorder point with increasing sales trend';
      } else if (salesTrend === 'decreasing') {
        suggestedQuantity *= 0.8;
        reason = 'Below reorder point but declining sales trend';
      } else {
        reason = 'Below reorder point';
      }
    } else if (stockRatio < 0.3 && salesTrend === 'increasing') {
      priority = 'medium';
      const targetStock = maxStock * 0.6;
      suggestedQuantity = Math.max(0, targetStock - currentStock);
      reason = 'Low stock with increasing demand';
    } else if (daysUntilStockout < 14 && avgMonthlySales > 0) {
      priority = 'medium';
      suggestedQuantity = Math.max(0, (avgMonthlySales * 1.1) - currentStock);
      reason = 'Will run out of stock within 2 weeks';
    } else if (stockRatio < 0.2) {
      priority = 'low';
      const targetStock = maxStock * 0.4;
      suggestedQuantity = Math.max(0, targetStock - currentStock);
      reason = 'Low stock level';
    }

    suggestedQuantity = Math.round(suggestedQuantity);

    return {
      sku: item.sku,
      description: item.description,
      currentStock,
      suggestedQuantity,
      priority,
      reason,
      estimatedCost: Number((suggestedQuantity * unitCost).toFixed(2)),
      daysUntilStockout: daysUntilStockout === Infinity ? null : Math.round(daysUntilStockout)
    };
  }).filter(s => s.suggestedQuantity > 0)
    .sort((a, b) => {
      const order = { high: 3, medium: 2, low: 1 };
      return order[b.priority] - order[a.priority];
    });

  return suggestions;
}

app.post('/suggestions', async (req, res) => {
  try {
    // Initialize Catalyst (available for auth/context if needed)
    try { catalyst.initialize(req); } catch (e) {}

    const skuData = req.body && (req.body.skuData || req.body);
    if (!Array.isArray(skuData)) {
      return res.status(400).json({ error: 'Invalid body. Expected { skuData: [...] } or an array.' });
    }

    const suggestions = calculateOrderSuggestions(skuData);
    const stats = {
      totalSuggestions: suggestions.length,
      high: suggestions.filter(s => s.priority === 'high').length,
      medium: suggestions.filter(s => s.priority === 'medium').length,
      low: suggestions.filter(s => s.priority === 'low').length,
      totalEstimatedCost: Number(suggestions.reduce((sum, s) => sum + s.estimatedCost, 0).toFixed(2))
    };

    res.json({ success: true, suggestions, stats });
  } catch (err) {
    console.error('Suggestion calc error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = app;