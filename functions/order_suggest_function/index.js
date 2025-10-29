'use strict';

/* eslint-disable */
const express = require('express');
const cors = require('cors');
const catalyst = require('zcatalyst-sdk-node');

const app = express();
app.use(express.json());

// CORS: allow Slate origin (or configured origin)
// Supports comma-separated list in ALLOWED_ORIGIN, e.g., "https://a.com,https://b.com"
const allowedOriginEnv = process.env.ALLOWED_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || '*';
const rawOrigins = allowedOriginEnv.split(',').map(o => o.trim()).filter(Boolean);

// Build matchers supporting exact and wildcard (e.g., https://*.onslate.com)
const allowedOrigins = rawOrigins.map((entry) => {
	const val = entry.replace(/\/$/, ''); // strip trailing slash
	if (val === '*') return { type: 'star', value: '*' };
	if (val.includes('*')) {
		// convert https://*.domain.com to regex
		const esc = val
			.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`)
			.replace(/\\\*/g, '.*');
		return { type: 'wildcard', value: val, regex: new RegExp(`^${esc}$`, 'i') };
	}
	return { type: 'exact', value: val.toLowerCase() };
});

function isOriginAllowed(origin) {
	if (!origin) return true; // server-to-server
	const o = origin.replace(/\/$/, '');
	for (const rule of allowedOrigins) {
		if (rule.type === 'star') return true;
		if (rule.type === 'exact' && rule.value === o.toLowerCase()) return true;
		if (rule.type === 'wildcard' && rule.regex && rule.regex.test(o)) return true;
	}
	return false;
}

// Prefer explicit, robust CORS handling to avoid proxy quirks
const credentialsEnabled = !allowedOrigins.some(r => r.type === 'star');

// Minimal manual CORS headers (in addition to cors package) to guarantee ACAO
app.use((req, res, next) => {
		const origin = req.headers.origin && String(req.headers.origin);
		if (allowedOrigins.some(r => r.type === 'star')) {
		// reflect origin when available, else wildcard
		if (origin) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
		} else {
			res.setHeader('Access-Control-Allow-Origin', '*');
		}
		res.setHeader('Access-Control-Allow-Credentials', 'false');
		} else if (origin && isOriginAllowed(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Vary', 'Origin');
		res.setHeader('Access-Control-Allow-Credentials', 'true');
	}
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	if (req.method === 'OPTIONS') {
		return res.status(204).end();
	}
	next();
});

// Also apply cors library as a secondary safety net
app.use(cors({
		origin: (origin, callback) => {
			if (!origin) return callback(null, true);
			if (allowedOrigins.some(r => r.type === 'star')) return callback(null, true);
			const ok = isOriginAllowed(origin);
			return callback(ok ? null : new Error('Origin not allowed by CORS'), ok);
		},
	credentials: credentialsEnabled,
	methods: ['GET', 'POST', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization'],
	optionsSuccessStatus: 204
}));
app.options('*', cors());

// Health check
app.get('/', (_req, res) => {
	res.json({ ok: true, service: 'order-suggestions', time: new Date().toISOString() });
});

// ===== Zoho helpers (OAuth + fetch) =====
const tokenCache = { accessToken: null, expiry: 0 };

async function getZohoAccessToken() {
	const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
	const clientId = process.env.ZOHO_CLIENT_ID;
	const clientSecret = process.env.ZOHO_CLIENT_SECRET;
	const accountsBase = process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com';

	if (!refreshToken || !clientId || !clientSecret) {
		throw new Error('Missing Zoho OAuth env vars (ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET)');
	}

	const now = Date.now();
	if (tokenCache.accessToken && tokenCache.expiry > now + 10_000) {
		return tokenCache.accessToken;
	}

	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: clientId,
		client_secret: clientSecret
	});

	const resp = await fetch(`${accountsBase}/oauth/v2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});

	if (!resp.ok) {
		const txt = await resp.text().catch(() => '');
		throw new Error(`Zoho token fetch failed: ${resp.status} ${txt}`);
	}
	const json = await resp.json();
	const token = json.access_token;
	const expiresIn = Number(json.expires_in || 3300) * 1000;
	tokenCache.accessToken = token;
	tokenCache.expiry = Date.now() + expiresIn;
	return token;
}

function inventoryHeaders(token, orgId) {
	return {
		'Authorization': `Zoho-oauthtoken ${token}`,
		'X-com-zoho-inventory-organizationid': orgId,
		'Content-Type': 'application/json'
	};
}

function booksHeaders(token, orgId) {
	return {
		'Authorization': `Zoho-oauthtoken ${token}`,
		'X-com-zoho-books-organizationid': orgId,
		'Content-Type': 'application/json'
	};
}

async function fetchAllInventoryItems({ token, orgId, base, perPage = 200, skus }) {
	const items = [];
	let page = 1;
	const baseUrl = base || 'https://inventory.zoho.com/api/v1';
	while (true) {
		const url = `${baseUrl}/items?per_page=${perPage}&page=${page}`;
		const resp = await fetch(url, { headers: inventoryHeaders(token, orgId) });
		if (!resp.ok) {
			const txt = await resp.text().catch(() => '');
			throw new Error(`Items fetch failed: ${resp.status} ${txt}`);
		}
		const data = await resp.json();
		const pageItems = (data.items || []).filter(it => it.track_inventory !== false);
		items.push(...pageItems);
		if (!data.page_context || !data.page_context.has_more_page) break;
		page += 1;
	}
	if (Array.isArray(skus) && skus.length) {
		const set = new Set(skus.map(s => String(s).toLowerCase()));
		return items.filter(it => set.has(String(it.sku || '').toLowerCase()));
	}
	return items;
}

async function fetchItemSalesHistory({ token, orgId, base, itemId, fromDate, toDate }) {
	const baseUrl = base || 'https://inventory.zoho.com/api/v1';
	const params = new URLSearchParams({ item_id: String(itemId), from_date: fromDate, to_date: toDate });
	const url = `${baseUrl}/reports/itemdetails?${params}`;
	const resp = await fetch(url, { headers: inventoryHeaders(token, orgId) });
	if (!resp.ok) {
		// If report not available, return empty
		return { sales_history: [] };
	}
	const json = await resp.json();
	return json || { sales_history: [] };
}

function calcTrendAndAvgMonthly(salesData) {
	const history = (salesData && salesData.sales_history) || [];
	if (!history.length) {
		return { salesTrend: 'stable', avgMonthlySales: 0, lastSale: null };
	}
	const quantities = history.map(h => Number(h.quantity || 0));
	const dates = history.map(h => h.date).filter(Boolean);
	const lastSale = dates.length ? dates.sort().slice(-1)[0] : null;
	const total = quantities.reduce((a, b) => a + b, 0);
	// Approx months based on weekly buckets
	const months = Math.max(1, history.length / 4);
	const avgMonthlySales = total / months;
	const split = Math.max(1, Math.floor(history.length / 2));
	const older = quantities.slice(0, split);
	const recent = quantities.slice(split);
	const olderAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : avgMonthlySales;
	const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : olderAvg;
	const change = olderAvg ? (recentAvg - olderAvg) / olderAvg : 0;
	const salesTrend = change > 0.1 ? 'increasing' : (change < -0.1 ? 'decreasing' : 'stable');
	return { salesTrend, avgMonthlySales, lastSale };
}

function normalizeItem(it, trendInfo) {
	return {
		sku: it.sku || it.item_id,
		description: it.name || it.description || '',
		currentStock: Number(it.stock_on_hand || it.available_stock || 0),
		reorderPoint: Number(it.reorder_level || 0),
		maxStock: Number(it.maximum_stock_level || 100),
		avgMonthlySales: Number(trendInfo.avgMonthlySales || 0),
		lastSale: trendInfo.lastSale || new Date().toISOString().slice(0, 10),
		lastSupplied: it.last_purchase_date || new Date().toISOString().slice(0, 10),
		supplier: it.vendor_name || it.preferred_vendor || 'Unknown',
		unitCost: Number(it.purchase_rate || it.cost_price || 0),
		category: it.category_name || it.item_type || 'General',
		salesTrend: trendInfo.salesTrend
	};
}

async function withConcurrency(items, limit, task) {
	const results = [];
	let idx = 0;
	const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
		while (true) {
			const i = idx++;
			if (i >= items.length) break;
			results[i] = await task(items[i], i);
		}
	});
	await Promise.all(workers);
	return results.filter(Boolean);
}

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
		try { catalyst.initialize(req); } catch (e) {}

		// Support live fetch toggle via query or body
		if ((req.query && (req.query.live === '1' || req.query.live === 'true')) || (req.body && (req.body.live === true))) {
			const months = Number(req.query.months || req.body?.months || 6);
			try {
				const token = await getZohoAccessToken();
				const orgId = process.env.ZOHO_ORG_ID;
				const inventoryBase = process.env.ZOHO_INVENTORY_BASE;
				if (!orgId) {
					return res.status(400).json({ error: 'Missing ZOHO_ORG_ID in environment' });
				}
				const from = new Date();
				from.setMonth(from.getMonth() - months);
				const fromDate = from.toISOString().slice(0, 10);
				const toDate = new Date().toISOString().slice(0, 10);
				const skus = Array.isArray(req.body?.skus) ? req.body.skus : undefined;

				const items = await fetchAllInventoryItems({ token, orgId, base: inventoryBase, skus });
				const limited = items.slice(0, Math.min(items.length, 100)); // pragmatic cap
				const normalized = await withConcurrency(limited, 5, async (it) => {
					const sales = await fetchItemSalesHistory({ token, orgId, base: inventoryBase, itemId: it.item_id, fromDate, toDate });
					const trend = calcTrendAndAvgMonthly(sales);
					return normalizeItem(it, trend);
				});
				const filtered = filterOrderableSKUs(normalized);
				const suggestions = calculateOrderSuggestions(filtered);
				const stats = {
					totalSuggestions: suggestions.length,
					high: suggestions.filter(s => s.priority === 'high').length,
					medium: suggestions.filter(s => s.priority === 'medium').length,
					low: suggestions.filter(s => s.priority === 'low').length,
					totalEstimatedCost: Number(suggestions.reduce((sum, s) => sum + s.estimatedCost, 0).toFixed(2))
				};
				return res.json({ success: true, suggestions, stats, source: 'live' });
			} catch (liveErr) {
				console.error('Live fetch error:', liveErr);
				return res.status(502).json({ error: 'Live fetch failed. Check Zoho credentials and scopes.' });
			}
		}

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

	// Live normalization only (no suggestions) if needed
	app.post('/fetch-live', async (req, res) => {
		try {
			const months = Number(req.query.months || req.body?.months || 6);
			const token = await getZohoAccessToken();
			const orgId = process.env.ZOHO_ORG_ID;
			const inventoryBase = process.env.ZOHO_INVENTORY_BASE;
			if (!orgId) {
				return res.status(400).json({ error: 'Missing ZOHO_ORG_ID in environment' });
			}
			const from = new Date();
			from.setMonth(from.getMonth() - months);
			const fromDate = from.toISOString().slice(0, 10);
			const toDate = new Date().toISOString().slice(0, 10);
			const skus = Array.isArray(req.body?.skus) ? req.body.skus : undefined;

			const items = await fetchAllInventoryItems({ token, orgId, base: inventoryBase, skus });
			const limited = items.slice(0, Math.min(items.length, 100));
			const normalized = await withConcurrency(limited, 5, async (it) => {
				const sales = await fetchItemSalesHistory({ token, orgId, base: inventoryBase, itemId: it.item_id, fromDate, toDate });
				const trend = calcTrendAndAvgMonthly(sales);
				return normalizeItem(it, trend);
			});
			const filtered = filterOrderableSKUs(normalized);
			res.json({ skuData: filtered, months });
		} catch (err) {
			console.error('fetch-live error:', err);
			res.status(502).json({ error: 'Live fetch failed. Check Zoho credentials and scopes.' });
		}
	});

module.exports = app;
