# Order Suggestion System - Zoho Slate App

A hot-deployed Zoho Slate App that provides AI-powered purchase order quantity suggestions based on sales trends and available stock levels.

## Features

### 🎯 Core Functionality
- **Smart SKU Filtering**: Automatically filters out SKUs beginning with `0-`, `800-`, and `2000-` as they are never to be ordered
- **AI-Powered Suggestions**: Calculates optimal order quantities based on:
  - Current stock levels
  - Reorder points
  - Sales trends (increasing, decreasing, stable)
  - Historical sales data
  - Days until stockout prediction

### 📊 Priority-Based Recommendations
- **High Priority**: Items below reorder point or critical stock situations
- **Medium Priority**: Items with low stock and increasing demand trends
- **Low Priority**: Items with low stock but manageable situations

### 🔍 Advanced Analytics
- Real-time stock analysis
- Sales trend detection
- Cost estimation for suggested orders
- Days until stockout calculations
- Export capabilities (CSV format)

### 🎨 User Interface
- Clean, responsive dashboard
- Real-time filtering and search
- Priority-based color coding
- Summary statistics cards
- Mobile-friendly design

## Technology Stack

- **Frontend**: Next.js 14 with TypeScript
- **Styling**: Tailwind CSS
- **API**: Next.js API Routes
- **Integration**: Zoho SDK for Slate Apps

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Installation & Setup

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Zoho Developer account

### Local Development
```bash
# Clone the repository
git clone <repository-url>
cd order-suggest

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

### Zoho Slate App Deployment
1. Create a new Slate app in Zoho Developer Console
2. Configure the app settings:
   - App Type: Widget
   - Hosting: External
   - URL: Your deployed application URL
3. Set up necessary API permissions for Inventory module
4. Deploy to your Zoho organization

## Configuration

### Environment Variables
Create a `.env.local` file:
```env
NEXT_PUBLIC_ZOHO_ORG_ID=your_org_id
NEXT_PUBLIC_ZOHO_APP_ID=your_app_id
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
```

### SKU Filtering Rules
The system automatically filters out:
- SKUs starting with `0-` (promotional items)
- SKUs starting with `800-` (service items)
- SKUs starting with `2000-` (special category items)

## API Endpoints

### POST /api/suggestions
Calculate order suggestions based on SKU data.

**Request Body:**
```json
{
  "skuData": [
    {
      "sku": "ABC-123",
      "description": "Widget A",
      "currentStock": 15,
      "reorderPoint": 20,
      "maxStock": 100,
      "avgMonthlySales": 25,
      "lastSale": "2024-10-25",
      "lastSupplied": "2024-09-15",
      "supplier": "Supplier XYZ",
      "unitCost": 12.50,
      "category": "Electronics",
      "salesTrend": "increasing"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "suggestions": [...],
  "totalSuggestions": 5,
  "highPriority": 2,
  "mediumPriority": 2,
  "lowPriority": 1,
  "totalEstimatedCost": 1250.00
}
```

## Algorithm Details

### Stock Analysis
The system evaluates each SKU based on multiple factors:

1. **Critical Stock Check**: Current stock vs. reorder point
2. **Stock Ratio Analysis**: Current stock as percentage of maximum capacity
3. **Sales Velocity**: Monthly sales rate converted to daily consumption
4. **Trend Adjustment**: Quantity adjustments based on sales trends
   - Increasing trend: +20% quantity boost
   - Decreasing trend: -20% quantity reduction
   - Stable trend: Standard calculation

### Priority Assignment
- **High**: Below reorder point or critical situations
- **Medium**: Low stock with increasing demand or approaching stockout
- **Low**: General low stock situations

### Quantity Calculation
```
Target Stock = Maximum Stock × 0.8 (for high priority)
Target Stock = Maximum Stock × 0.6 (for medium priority)
Target Stock = Maximum Stock × 0.4 (for low priority)

Suggested Quantity = Target Stock - Current Stock
```

## Zoho Integration

### Required Permissions
- `ZohoInventory.items.READ`
- `ZohoInventory.reports.READ`
- `ZohoInventory.purchaseorders.CREATE`

### Data Mapping
The app maps Zoho Inventory data to internal format:
- `item_id` or `sku` → SKU
- `stock_on_hand` → Current Stock
- `reorder_level` → Reorder Point
- `purchase_rate` → Unit Cost

## Customization

### Adding New Filtering Rules
Modify the `filterOrderableSKUs` function in both the frontend and API:

```typescript
const filterOrderableSKUs = (data: SKUData[]): SKUData[] => {
  return data.filter(item => {
    const sku = item.sku.toLowerCase();
    return !sku.startsWith('0-') && 
           !sku.startsWith('800-') && 
           !sku.startsWith('2000-') &&
           !sku.startsWith('new-prefix-'); // Add new rules here
  });
};
```

### Adjusting Calculation Logic
Modify the `calculateOrderSuggestions` function to adjust:
- Priority thresholds
- Target stock percentages
- Trend multipliers
- Stockout warning periods

## Troubleshooting

### Common Issues
1. **Zoho SDK not loading**: Ensure proper app configuration in Zoho Console
2. **Data not appearing**: Check API permissions and data format
3. **Filtering not working**: Verify SKU formats and filtering logic

### Debug Mode
Enable debug logging by setting:
```javascript
window.localStorage.setItem('debug', 'true');
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Support

For issues and feature requests:
1. Check the troubleshooting section
2. Review Zoho Developer documentation
3. Contact your system administrator

## License

This project is licensed under the MIT License.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
