import { NextRequest, NextResponse } from 'next/server';

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
const calculateOrderSuggestions = (data: SKUData[]): OrderSuggestion[] => {
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
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { skuData } = body;

    if (!skuData || !Array.isArray(skuData)) {
      return NextResponse.json(
        { error: 'Invalid SKU data provided' },
        { status: 400 }
      );
    }

    const suggestions = calculateOrderSuggestions(skuData);
    
    return NextResponse.json({
      success: true,
      suggestions,
      totalSuggestions: suggestions.length,
      highPriority: suggestions.filter(s => s.priority === 'high').length,
      mediumPriority: suggestions.filter(s => s.priority === 'medium').length,
      lowPriority: suggestions.filter(s => s.priority === 'low').length,
      totalEstimatedCost: suggestions.reduce((sum, s) => sum + s.estimatedCost, 0)
    });
  } catch (error) {
    console.error('Error calculating suggestions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Order Suggestion API',
    description: 'POST SKU data to get purchase order suggestions',
    endpoints: {
      'POST /api/suggestions': 'Calculate order suggestions based on SKU data'
    }
  });
}