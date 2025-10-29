/* eslint-disable @typescript-eslint/no-explicit-any */
// Zoho Slate App Configuration and Helper Functions

interface ZohoConfig {
  orgId: string;
  entityId: string;
  entityType: string;
  appName: string;
}

interface ZohoSDK {
  init: () => Promise<void>;
  get: (config: any) => Promise<any>;
  request: (config: any) => Promise<any>;
  set: (config: any) => Promise<any>;
}

declare global {
  interface Window {
    $zoho?: {
      desk?: ZohoSDK;
      crm?: ZohoSDK;
      inventory?: ZohoSDK;
    };
  }
}

export class ZohoIntegration {
  private sdk: ZohoSDK | null = null;
  private initialized = false;

  constructor(private module: 'desk' | 'crm' | 'inventory' = 'inventory') {
    this.initializeSDK();
  }

  private async initializeSDK() {
    if (typeof window === 'undefined') return;
    
    try {
      // Wait for Zoho SDK to be available
      while (!window.$zoho?.[this.module]) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      this.sdk = window.$zoho[this.module]!;
      await this.sdk.init();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize Zoho SDK:', error);
    }
  }

  async isReady(): Promise<boolean> {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max wait
    
    while (!this.initialized && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    return this.initialized;
  }

  // Get SKU/Item data from Zoho Inventory
  async getInventoryItems(): Promise<any[]> {
    if (!await this.isReady()) {
      throw new Error('Zoho SDK not initialized');
    }

    try {
      const response = await this.sdk!.request({
        url: '/inventory/v1/items',
        method: 'GET',
        params: {
          page: 1,
          per_page: 200
        }
      });

      return response.items || [];
    } catch (error) {
      console.error('Error fetching inventory items:', error);
      return [];
    }
  }

  // Get sales data for trend analysis
  async getSalesData(itemId: string, months: number = 6): Promise<any> {
    if (!await this.isReady()) {
      throw new Error('Zoho SDK not initialized');
    }

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      const response = await this.sdk!.request({
        url: `/inventory/v1/reports/itemdetails`,
        method: 'GET',
        params: {
          item_id: itemId,
          from_date: startDate.toISOString().split('T')[0],
          to_date: endDate.toISOString().split('T')[0]
        }
      });

      return response;
    } catch (error) {
      console.error('Error fetching sales data:', error);
      return null;
    }
  }

  // Transform Zoho data to our SKUData format
  transformZohoData(zohoItem: any, salesData?: any): any {
    const salesTrend = this.calculateSalesTrend(salesData);
    
    return {
      sku: zohoItem.sku || zohoItem.item_id,
      description: zohoItem.name || zohoItem.description,
      currentStock: zohoItem.stock_on_hand || 0,
      reorderPoint: zohoItem.reorder_level || 0,
      maxStock: zohoItem.maximum_stock_level || 100,
      avgMonthlySales: this.calculateAvgMonthlySales(salesData),
      lastSale: zohoItem.last_sales_date || new Date().toISOString().split('T')[0],
      lastSupplied: zohoItem.last_purchase_date || new Date().toISOString().split('T')[0],
      supplier: zohoItem.vendor_name || zohoItem.preferred_vendor || 'Unknown',
      unitCost: parseFloat(zohoItem.purchase_rate || zohoItem.cost_price || '0'),
      category: zohoItem.category_name || zohoItem.item_type || 'General',
      salesTrend
    };
  }

  private calculateSalesTrend(salesData: any): 'increasing' | 'decreasing' | 'stable' {
    if (!salesData || !salesData.sales_history) return 'stable';
    
    const history = salesData.sales_history;
    if (history.length < 2) return 'stable';
    
    const recent = history.slice(-3);
    const older = history.slice(0, -3);
    
    const recentAvg = recent.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0) / recent.length;
    const olderAvg = older.length > 0 
      ? older.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0) / older.length 
      : recentAvg;
    
    const change = (recentAvg - olderAvg) / olderAvg;
    
    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private calculateAvgMonthlySales(salesData: any): number {
    if (!salesData || !salesData.sales_history) return 0;
    
    const totalSales = salesData.sales_history.reduce(
      (sum: number, item: any) => sum + (item.quantity || 0), 
      0
    );
    
    const months = Math.max(1, salesData.sales_history.length / 4); // Assuming weekly data
    return totalSales / months;
  }

  // Create purchase order in Zoho
  async createPurchaseOrder(suggestions: any[]): Promise<boolean> {
    if (!await this.isReady()) {
      throw new Error('Zoho SDK not initialized');
    }

    try {
      const orderData = {
        vendor_id: '', // Will need to be specified
        purchase_order_number: `PO-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        line_items: suggestions.map(suggestion => ({
          item_id: suggestion.sku,
          name: suggestion.description,
          quantity: suggestion.suggestedQuantity,
          rate: suggestion.estimatedCost / suggestion.suggestedQuantity
        }))
      };

      const response = await this.sdk!.request({
        url: '/inventory/v1/purchaseorders',
        method: 'POST',
        data: orderData
      });

      return response.code === 0;
    } catch (error) {
      console.error('Error creating purchase order:', error);
      return false;
    }
  }

  // Get organization context
  async getOrgContext(): Promise<ZohoConfig | null> {
    if (!await this.isReady()) {
      return null;
    }

    try {
      const context = await this.sdk!.get({
        key: 'user'
      });

      return {
        orgId: context.org_id,
        entityId: context.entity_id,
        entityType: context.entity_type,
        appName: 'order-suggest'
      };
    } catch (error) {
      console.error('Error getting org context:', error);
      return null;
    }
  }
}

// Helper function to filter SKUs
export function shouldFilterSKU(sku: string): boolean {
  const normalizedSku = sku.toLowerCase().trim();
  return normalizedSku.startsWith('0-') || 
         normalizedSku.startsWith('800-') || 
         normalizedSku.startsWith('2000-');
}

// Create a singleton instance
export const zohoIntegration = new ZohoIntegration();

export default ZohoIntegration;