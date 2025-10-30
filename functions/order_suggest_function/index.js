'use strict';

/* eslint-disable */
const express = require('express');
const cors = require('cors');
const catalyst = require('zcatalyst-sdk-node');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// CORS: allow Slate origin (or configured origin)
// Supports comma-separated list in env. Accepted env names:
// - ALLOWED_ORIGIN (preferred)
// - ALLOW_ORIGIN (alias)
// - CORS_ALLOWED_ORIGINS (alias)
// Default to allow all onslate subdomains in addition to provided values
const allowedOriginEnv = process.env.ALLOWED_ORIGIN
	|| process.env.ALLOW_ORIGIN
	|| process.env.CORS_ALLOWED_ORIGINS
	|| '';
// Always include onslate wildcard to support Slate apps across environments
const mergedOrigins = [allowedOriginEnv, 'https://*.onslate.com']
	.filter(Boolean)
	.join(',');
const rawOrigins = mergedOrigins.split(',').map(o => o.trim()).filter(Boolean);

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

// Extended health check: validates Zoho token acquisition and env wiring
app.get('/healthz', async (_req, res) => {
	const info = {
		ok: true,
		service: 'order-suggestions',
		time: new Date().toISOString(),
		accountsBase: process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com',
		inventoryBase: process.env.ZOHO_INVENTORY_BASE || 'https://inventory.zoho.com/api/v1',
		booksBase: process.env.ZOHO_BOOKS_BASE || 'https://www.zohoapis.com/books/v3',
		provider: getSourceProvider(),
		orgIdPresent: Boolean(process.env.ZOHO_ORG_ID),
		tokenOk: false,
		error: undefined
	};
	try {
		const token = await getZohoAccessToken();
		info.tokenOk = Boolean(token);
		return res.json(info);
	} catch (e) {
		info.tokenOk = false;
		info.error = e && e.message ? String(e.message) : 'token error';
		return res.status(502).json(info);
	}
});

// Inventory probe: attempts a light items fetch to validate scopes and org wiring
app.get('/healthz/inventory', async (_req, res) => {
	const result = {
		ok: false,
		accountsBase: process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com',
		inventoryBase: process.env.ZOHO_INVENTORY_BASE || 'https://inventory.zoho.com/api/v1',
		orgIdPresent: Boolean(process.env.ZOHO_ORG_ID),
		itemsCount: 0,
		error: undefined
	};
	try {
		const token = await getZohoAccessToken();
		const orgId = process.env.ZOHO_ORG_ID;
		if (!orgId) return res.status(400).json({ ...result, error: 'Missing ZOHO_ORG_ID' });
		const base = process.env.ZOHO_INVENTORY_BASE;
		const url = `${base || 'https://inventory.zoho.com/api/v1'}/items?per_page=5&page=1`;
		const resp = await fetch(url, { headers: inventoryHeaders(token, orgId) });
		const text = await resp.text();
		if (!resp.ok) {
			result.error = `Fetch items failed: ${resp.status} ${text.slice(0,300)}`;
			return res.status(502).json(result);
		}
		const json = JSON.parse(text);
		const pageItems = (json.items || []).filter(it => it.track_inventory !== false);
		result.ok = true;
		result.itemsCount = pageItems.length;
		return res.json(result);
	} catch (e) {
		result.error = e && e.message ? String(e.message) : 'inventory probe error';
		return res.status(502).json(result);
	}
});

// Books probe: attempts a light items fetch to validate scopes and org wiring
app.get('/healthz/books', async (_req, res) => {
	const result = {
		ok: false,
		accountsBase: process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com',
		booksBase: process.env.ZOHO_BOOKS_BASE || 'https://www.zohoapis.com/books/v3',
		orgIdPresent: Boolean(process.env.ZOHO_ORG_ID),
		itemsCount: 0,
		error: undefined
	};
	try {
		const token = await getZohoAccessToken();
		const orgId = process.env.ZOHO_ORG_ID;
		if (!orgId) return res.status(400).json({ ...result, error: 'Missing ZOHO_ORG_ID' });
		const base = process.env.ZOHO_BOOKS_BASE;
		const baseUrl = base || 'https://www.zohoapis.com/books/v3';
		const url = `${baseUrl}/items?organization_id=${encodeURIComponent(orgId)}&per_page=5&page=1`;
		const resp = await fetch(url, { headers: booksHeaders(token, orgId) });
		const text = await resp.text();
		if (!resp.ok) {
			result.error = `Fetch items failed: ${resp.status} ${text.slice(0,300)}`;
			return res.status(502).json(result);
		}
		const json = JSON.parse(text);
		const pageItems = Array.isArray(json.items) ? json.items : [];
		result.ok = true;
		result.itemsCount = pageItems.length;
		return res.json(result);
	} catch (e) {
		result.error = e && e.message ? String(e.message) : 'books probe error';
		return res.status(502).json(result);
	}
});

// ===== Zoho helpers (OAuth + fetch) =====
const tokenCache = { accessToken: null, expiry: 0 };

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, { retries = 3, backoffMs = 300 } = {}) {
	let attempt = 0;
	let lastErr;
	while (attempt <= retries) {
		try {
			const resp = await fetch(url, options);
			if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
				// retryable
				const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
				await sleep(delay);
				attempt += 1;
				lastErr = new Error(`HTTP ${resp.status}`);
				continue;
			}
			return resp;
		} catch (e) {
			lastErr = e;
			const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
			await sleep(delay);
			attempt += 1;
		}
	}
	throw lastErr || new Error('fetch failed');
}

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

function getSourceProvider() {
    const val = String(process.env.ZOHO_SOURCE || '').toLowerCase().trim();
    if (val === 'books' || val === 'inventory') return val;
    // Fallback: prefer inventory if explicitly configured, else books
    if (process.env.ZOHO_INVENTORY_BASE) return 'inventory';
    if (process.env.ZOHO_BOOKS_BASE) return 'books';
    return 'inventory';
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

// ===== Zoho Books helpers =====
async function fetchAllBooksItems({ token, orgId, base, perPage = 200, skus }) {
	const items = [];
	let page = 1;
	const baseUrl = base || 'https://www.zohoapis.com/books/v3';
	while (true) {
		const url = `${baseUrl}/items?organization_id=${encodeURIComponent(orgId)}&per_page=${perPage}&page=${page}`;
	const resp = await fetchWithRetry(url, { headers: booksHeaders(token, orgId) });
		if (!resp.ok) {
			const txt = await resp.text().catch(() => '');
			throw new Error(`Books items fetch failed: ${resp.status} ${txt}`);
		}
		const data = await resp.json();
		const pageItems = Array.isArray(data.items) ? data.items : [];
		items.push(...pageItems);
		const pc = data.page_context || {};
		if (!pc.has_more_page) break;
		page += 1;
	}
	if (Array.isArray(skus) && skus.length) {
		const set = new Set(skus.map(s => String(s).toLowerCase()));
		return items.filter(it => set.has(String(it.sku || '').toLowerCase()));
	}
	return items;
}

// Fetch only a specific range of Books items using page math to avoid fetching all items repeatedly
async function fetchBooksItemsPagedRange({ token, orgId, base, start = 0, count = 20, perPage = 200 }) {
	const items = [];
	const baseUrl = base || 'https://www.zohoapis.com/books/v3';
	const startPage = Math.floor(start / perPage) + 1;
	const endIndex = start + count; // exclusive
	const endPage = Math.floor((endIndex - 1) / perPage) + 1;
	for (let page = startPage; page <= endPage; page++) {
		const url = `${baseUrl}/items?organization_id=${encodeURIComponent(orgId)}&per_page=${perPage}&page=${page}`;
		const resp = await fetchWithRetry(url, { headers: booksHeaders(token, orgId) });
		if (!resp.ok) {
			const txt = await resp.text().catch(() => '');
			throw new Error(`Books items page fetch failed: ${resp.status} ${txt}`);
		}
		const data = await resp.json();
		const pageItems = Array.isArray(data.items) ? data.items : [];
		items.push(...pageItems);
		const pc = data.page_context || {};
		if (!pc.has_more_page && page < endPage) {
			break; // fewer pages than expected
		}
	}
	const offsetInFirstPage = start % perPage;
	return items.slice(offsetInFirstPage, offsetInFirstPage + count);
}

async function fetchBooksItemDetail({ token, orgId, base, itemId }) {
	const baseUrl = base || 'https://www.zohoapis.com/books/v3';
	const url = `${baseUrl}/items/${encodeURIComponent(itemId)}?organization_id=${encodeURIComponent(orgId)}`;
	const resp = await fetchWithRetry(url, { headers: booksHeaders(token, orgId) });
	if (!resp.ok) {
		const txt = await resp.text().catch(() => '');
		throw new Error(`Books item detail fetch failed: ${resp.status} ${txt}`);
	}
	const data = await resp.json();
	return data && data.item ? data.item : null;
}

function weekStart(dateStr) {
	const d = new Date(dateStr);
	if (Number.isNaN(d.getTime())) return null;
	d.setUTCHours(0, 0, 0, 0);
	const day = d.getUTCDay(); // 0=Sun..6=Sat
	const diff = (day + 6) % 7; // back to Monday
	d.setUTCDate(d.getUTCDate() - diff);
	return d.toISOString().slice(0, 10);
}

async function fetchItemSalesHistoryBooks({ token, orgId, base, itemId, fromDate, toDate, maxPages = 12 }) {
	const baseUrl = base || 'https://www.zohoapis.com/books/v3';
	const params = new URLSearchParams({
		organization_id: String(orgId),
		item_id: String(itemId),
		date_start: fromDate,
		date_end: toDate,
		per_page: '200',
		page: '1'
	});
	const weekly = new Map();
	let page = 1;
	while (true) {
		params.set('page', String(page));
		const url = `${baseUrl}/invoices?${params.toString()}`;
	const resp = await fetchWithRetry(url, { headers: booksHeaders(token, orgId) });
		if (!resp.ok) {
			// If invoices not accessible, return empty and let caller handle
			return { sales_history: [] };
		}
		const data = await resp.json();
		const list = Array.isArray(data.invoices) ? data.invoices : [];
		if (list.length === 0) break;
		// Fetch invoice details in parallel with limited concurrency
		const results = await withConcurrency(list, 4, async (inv) => {
			const invId = inv && (inv.invoice_id || inv.invoiceId || inv.id);
			if (!invId) return null;
			const invUrl = `${baseUrl}/invoices/${encodeURIComponent(invId)}?organization_id=${encodeURIComponent(orgId)}`;
			const invResp = await fetchWithRetry(invUrl, { headers: booksHeaders(token, orgId) });
			if (!invResp.ok) return null;
			const invData = await invResp.json();
			const invObj = invData && invData.invoice ? invData.invoice : null;
			if (!invObj) return null;
			const invDate = invObj.date || inv.date;
			const w = weekStart(invDate);
			if (!w) return null;
			const lines = Array.isArray(invObj.line_items) ? invObj.line_items : [];
			const qty = lines
				.filter(li => String(li.item_id || '') === String(itemId))
				.reduce((sum, li) => sum + Number(li.quantity || 0), 0);
			return { w, qty };
		});
		for (const r of results) {
			if (!r) continue;
			if (r.qty > 0) weekly.set(r.w, (weekly.get(r.w) || 0) + r.qty);
		}
		const pc = data.page_context || {};
		if (!pc.has_more_page) break;
		page += 1;
		// Safety: cap pages to avoid long loops
		if (page > maxPages) break;
	}
	const history = Array.from(weekly.entries())
		.map(([date, quantity]) => ({ date, quantity }))
		.sort((a, b) => a.date.localeCompare(b.date));
	return { sales_history: history };
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

		const wantLive = Boolean((req.query && (req.query.live === '1' || req.query.live === 'true')) || (req.body && req.body.live === true));
		if (wantLive) {
			const months = Number(req.query.months || req.body?.months || 6);
			try {
				const token = await getZohoAccessToken();
				const orgId = process.env.ZOHO_ORG_ID;
				const provider = getSourceProvider();
				const inventoryBase = process.env.ZOHO_INVENTORY_BASE;
				const booksBase = process.env.ZOHO_BOOKS_BASE;
				if (!orgId) {
					return res.status(400).json({ error: 'Missing ZOHO_ORG_ID in environment' });
				}
				const from = new Date();
				from.setMonth(from.getMonth() - months);
				const fromDate = from.toISOString().slice(0, 10);
				const toDate = new Date().toISOString().slice(0, 10);
				const skus = Array.isArray(req.body?.skus) ? req.body.skus : undefined;
				let normalized = [];
				if (provider === 'books') {
					const items = await fetchAllBooksItems({ token, orgId, base: booksBase, skus });
					const limited = items.slice(0, Math.min(items.length, 100));
					normalized = await withConcurrency(limited, 4, async (it) => {
						let detail = it;
						if (!Array.isArray(it.locations)) {
							try { detail = await fetchBooksItemDetail({ token, orgId, base: booksBase, itemId: it.item_id }); } catch(_) {}
						}
						const locations = Array.isArray(detail?.locations) ? detail.locations : [];
						const currentStock = locations.reduce((sum, loc) => sum + Number(loc.location_available_stock || loc.location_stock_on_hand || 0), 0);
						const sales = await fetchItemSalesHistoryBooks({ token, orgId, base: booksBase, itemId: it.item_id, fromDate, toDate });
						const trend = calcTrendAndAvgMonthly(sales);
						const enriched = { ...it, stock_on_hand: currentStock, available_stock: currentStock };
						return normalizeItem(enriched, trend);
					});
				} else {
					const items = await fetchAllInventoryItems({ token, orgId, base: inventoryBase, skus });
					const limited = items.slice(0, Math.min(items.length, 100));
					normalized = await withConcurrency(limited, 5, async (it) => {
						const sales = await fetchItemSalesHistory({ token, orgId, base: inventoryBase, itemId: it.item_id, fromDate, toDate });
						const trend = calcTrendAndAvgMonthly(sales);
						return normalizeItem(it, trend);
					});
				}
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
				const detail = (liveErr && liveErr.message) ? String(liveErr.message) : undefined;
				return res.status(502).json({ error: 'Live fetch failed. Check Zoho credentials and scopes.', detail });
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

// Support GET to avoid CORS preflight in browsers (no custom headers/body)
app.get('/suggestions', async (req, res) => {
	try {
		try { catalyst.initialize(req); } catch (e) {}

		// DB-first path: if not explicitly live=1, try precomputed suggestions
		const months = Number(req.query && req.query.months || 6);
		const live = String(req.query && req.query.live || '');
		if (!live || live === '0' || live.toLowerCase() === 'false') {
			try {
				const appInst = catalyst.initialize(req);
				const { suggestionsTable, jobsTable } = getEnvTableNames();
				const zcql = await getZcql(appInst);
				// Get latest completed job
				const jobRows = await zcql.executeZCQLQuery(`SELECT job_id, finished_at FROM ${jobsTable} WHERE status='done' ORDER BY finished_at DESC`);
				if (!Array.isArray(jobRows) || jobRows.length === 0) {
					return res.status(202).json({ message: 'No precomputed suggestions available. Start a precompute job.' });
				}
				const latest = jobRows[0][jobsTable];
				const job_id = latest.job_id;
				// Fetch suggestions for that job
				const rows = await zcql.executeZCQLQuery(`SELECT * FROM ${suggestionsTable} WHERE job_id='${job_id}'`);
				const list = rows.map(r => r[suggestionsTable]);
				const suggestions = list.map(row => ({
					sku: row.sku,
					description: row.description,
					currentStock: Number(row.current_stock || 0),
					suggestedQuantity: Number(row.suggested_quantity || 0),
					priority: row.priority_level || row.priority || 'low',
					reason: row.reason || '',
					estimatedCost: Number(row.estimated_cost || 0),
					daysUntilStockout: row.days_until_stockout === null || row.days_until_stockout === undefined ? Infinity : Number(row.days_until_stockout)
				}));
				const stats = {
					totalSuggestions: suggestions.length,
					high: suggestions.filter(s => s.priority === 'high').length,
					medium: suggestions.filter(s => s.priority === 'medium').length,
					low: suggestions.filter(s => s.priority === 'low').length,
					totalEstimatedCost: Number(suggestions.reduce((sum, s) => sum + s.estimatedCost, 0).toFixed(2))
				};
				return res.json({ success: true, suggestions, stats, source: 'precomputed', job_id });
			} catch (dbErr) {
				// If DB path fails, fall back only if explicitly requested later
				return res.status(202).json({ message: 'Precomputed suggestions unavailable.', detail: dbErr && dbErr.message });
			}
		}

		// live path only when explicitly requested
		if (live === '1' || live.toLowerCase() === 'true') {
			try {
				const token = await getZohoAccessToken();
				const orgId = process.env.ZOHO_ORG_ID;
				const provider = getSourceProvider();
				const inventoryBase = process.env.ZOHO_INVENTORY_BASE;
				const booksBase = process.env.ZOHO_BOOKS_BASE;
				if (!orgId) {
					return res.status(400).json({ error: 'Missing ZOHO_ORG_ID in environment' });
				}
				const from = new Date();
				from.setMonth(from.getMonth() - months);
				const fromDate = from.toISOString().slice(0, 10);
				const toDate = new Date().toISOString().slice(0, 10);
				const skus = undefined; // GET does not accept body; pass via query in future if needed
				let normalized = [];
				if (provider === 'books') {
					const items = await fetchAllBooksItems({ token, orgId, base: booksBase, skus });
					const limited = items.slice(0, Math.min(items.length, 100));
					normalized = await withConcurrency(limited, 4, async (it) => {
						let detail = it;
						if (!Array.isArray(it.locations)) {
							try { detail = await fetchBooksItemDetail({ token, orgId, base: booksBase, itemId: it.item_id }); } catch(_) {}
						}
						const locations = Array.isArray(detail?.locations) ? detail.locations : [];
						const currentStock = locations.reduce((sum, loc) => sum + Number(loc.location_available_stock || loc.location_stock_on_hand || 0), 0);
						const sales = await fetchItemSalesHistoryBooks({ token, orgId, base: booksBase, itemId: it.item_id, fromDate, toDate });
						const trend = calcTrendAndAvgMonthly(sales);
						const enriched = { ...it, stock_on_hand: currentStock, available_stock: currentStock };
						return normalizeItem(enriched, trend);
					});
				} else {
					const items = await fetchAllInventoryItems({ token, orgId, base: inventoryBase, skus });
					const limited = items.slice(0, Math.min(items.length, 100));
					normalized = await withConcurrency(limited, 5, async (it) => {
						const sales = await fetchItemSalesHistory({ token, orgId, base: inventoryBase, itemId: it.item_id, fromDate, toDate });
						const trend = calcTrendAndAvgMonthly(sales);
						return normalizeItem(it, trend);
					});
				}
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
						console.error('Live fetch error (GET):', liveErr);
						const detail = (liveErr && liveErr.message) ? String(liveErr.message) : undefined;
						return res.status(502).json({ error: 'Live fetch failed. Check Zoho credentials and scopes.', detail });
			}
		}

				return res.status(400).json({ error: 'Provide live=1 for live mode or run precompute to serve fast results.' });
	} catch (err) {
		console.error('Suggestion GET error:', err);
		res.status(500).json({ error: 'Internal server error' });
	}
});

	// Live normalization only (no suggestions) if needed
	app.post('/fetch-live', async (req, res) => {
		try {
			const months = Number(req.query.months || req.body?.months || 6);
			const token = await getZohoAccessToken();
			const orgId = process.env.ZOHO_ORG_ID;
			const provider = getSourceProvider();
			const inventoryBase = process.env.ZOHO_INVENTORY_BASE;
			const booksBase = process.env.ZOHO_BOOKS_BASE;
			if (!orgId) {
				return res.status(400).json({ error: 'Missing ZOHO_ORG_ID in environment' });
			}
			const from = new Date();
			from.setMonth(from.getMonth() - months);
			const fromDate = from.toISOString().slice(0, 10);
			const toDate = new Date().toISOString().slice(0, 10);
			const skus = Array.isArray(req.body?.skus) ? req.body.skus : undefined;
			let normalized = [];
			if (provider === 'books') {
				const items = await fetchAllBooksItems({ token, orgId, base: booksBase, skus });
				const limited = items.slice(0, Math.min(items.length, 100));
				normalized = await withConcurrency(limited, 4, async (it) => {
					let detail = it;
					if (!Array.isArray(it.locations)) {
						try { detail = await fetchBooksItemDetail({ token, orgId, base: booksBase, itemId: it.item_id }); } catch(_) {}
					}
					const locations = Array.isArray(detail?.locations) ? detail.locations : [];
					const currentStock = locations.reduce((sum, loc) => sum + Number(loc.location_available_stock || loc.location_stock_on_hand || 0), 0);
					const sales = await fetchItemSalesHistoryBooks({ token, orgId, base: booksBase, itemId: it.item_id, fromDate, toDate });
					const trend = calcTrendAndAvgMonthly(sales);
					const enriched = { ...it, stock_on_hand: currentStock, available_stock: currentStock };
					return normalizeItem(enriched, trend);
				});
			} else {
				const items = await fetchAllInventoryItems({ token, orgId, base: inventoryBase, skus });
				const limited = items.slice(0, Math.min(items.length, 100));
				normalized = await withConcurrency(limited, 5, async (it) => {
					const sales = await fetchItemSalesHistory({ token, orgId, base: inventoryBase, itemId: it.item_id, fromDate, toDate });
					const trend = calcTrendAndAvgMonthly(sales);
					return normalizeItem(it, trend);
				});
			}
			const filtered = filterOrderableSKUs(normalized);
			res.json({ skuData: filtered, months });
		} catch (err) {
			console.error('fetch-live error:', err);
			const detail = (err && err.message) ? String(err.message) : undefined;
			res.status(502).json({ error: 'Live fetch failed. Check Zoho credentials and scopes.', detail });
		}
	});

module.exports = app;
/**
 * ===== Precompute (Cloud Scale Data Store) =====
 * Endpoints:
 * - POST /precompute/start { months?: number } -> { job_id }
 * - POST /precompute/run?job_id=... (idempotent, chunked)
 * - GET  /precompute/status?job_id=... -> progress/status
 *
 * Storage:
 * - Env SUGGESTIONS_TABLE (table name)
 * - Env JOBS_TABLE (table name)
 */

function getEnvTableNames() {
	const suggestionsTable = process.env.SUGGESTIONS_TABLE;
	const jobsTable = process.env.JOBS_TABLE;
	if (!suggestionsTable || !jobsTable) {
		throw new Error('Missing Data Store table env vars: SUGGESTIONS_TABLE and JOBS_TABLE');
	}
	return { suggestionsTable, jobsTable };
}

async function getTableByName(app, tableName) {
	const ds = app.datastore();
	const all = await ds.getAllTables();
	for (const t of all) {
		const meta = t.toJSON ? t.toJSON() : (t._tableDetails || {});
		if (meta && (meta.table_name === tableName || meta.table_name === String(tableName))) {
			return t;
		}
	}
	throw new Error(`Table not found: ${tableName}`);
}

async function getZcql(app) {
	return app.zcql();
}

// Datastore DATETIME expects 'YYYY-MM-DD HH:mm:ss'
function dsNow() {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	const yyyy = d.getFullYear();
	const MM = pad(d.getMonth() + 1);
	const dd = pad(d.getDate());
	const HH = pad(d.getHours());
	const mm = pad(d.getMinutes());
	const ss = pad(d.getSeconds());
	return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
}

function genJobId() {
	return `job_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

// Start a precompute job
app.post('/precompute/start', async (req, res) => {
	try {
		if (process.env.ADMIN_TOKEN) {
			const h = req.headers['x-admin-token'];
			if (!h || String(h) !== String(process.env.ADMIN_TOKEN)) {
				return res.status(401).json({ error: 'Unauthorized' });
			}
		}
		const appInst = catalyst.initialize(req);
		const { suggestionsTable, jobsTable } = getEnvTableNames();
		// Probe item count (rough) from Books
		const token = await getZohoAccessToken();
		const orgId = process.env.ZOHO_ORG_ID;
		if (!orgId) return res.status(400).json({ error: 'Missing ZOHO_ORG_ID in environment' });
		const provider = getSourceProvider();
		const months = Number(req.body?.months || 6);
		if (provider !== 'books') {
			return res.status(400).json({ error: 'Precompute currently supports provider=books only' });
		}
		const booksBase = process.env.ZOHO_BOOKS_BASE;
		const items = await fetchAllBooksItems({ token, orgId, base: booksBase, perPage: 200 });
		const total = items.length;

		const ds = appInst.datastore();
		const jobsTbl = await getTableByName(appInst, jobsTable);
		const job_id = genJobId();
			await jobsTbl.insertRow({
			job_id,
			status: 'queued',
			total_items: total,
			processed_items: 0,
				started_at: dsNow(),
				// omit finished_at on insert; set on completion
			error: null,
			provider,
			months,
				cursor_pos: 0
		});
		return res.json({ job_id, total_items: total });
	} catch (e) {
		// Improve diagnostics without leaking secrets
		const msg = e && (e.message || (typeof e === 'string' && e) || (e.toString && e.toString())) ? String(e.message || e) : 'precompute start failed';
		console.error('Precompute start error:', e);
		return res.status(502).json({ error: 'precompute start failed', detail: msg });
	}
});

// Run a precompute chunk
app.post('/precompute/run', async (req, res) => {
	const started = Date.now();
	try {
		if (process.env.ADMIN_TOKEN) {
			const h = req.headers['x-admin-token'];
			if (!h || String(h) !== String(process.env.ADMIN_TOKEN)) {
				return res.status(401).json({ error: 'Unauthorized' });
			}
		}
		const appInst = catalyst.initialize(req);
		const { suggestionsTable, jobsTable } = getEnvTableNames();
		const token = await getZohoAccessToken();
		const orgId = process.env.ZOHO_ORG_ID;
		if (!orgId) return res.status(400).json({ error: 'Missing ZOHO_ORG_ID' });
		const booksBase = process.env.ZOHO_BOOKS_BASE;
		const zcql = await getZcql(appInst);
		const job_id = String(req.query.job_id || req.body?.job_id || '');
		if (!job_id) return res.status(400).json({ error: 'job_id required' });

		const jobsTableName = jobsTable;
		const suggTableName = suggestionsTable;
		// Fetch job via ZCQL to get ROWID
		const jobRows = await zcql.executeZCQLQuery(`SELECT ROWID,* FROM ${jobsTableName} WHERE job_id='${job_id}'`);
		if (!Array.isArray(jobRows) || jobRows.length === 0) {
			return res.status(404).json({ error: 'job not found' });
		}
		const jobData = jobRows[0][jobsTableName];
		const jobROWID = jobData.ROWID;
		const total = Number(jobData.total_items || 0);
		let processed = Number(jobData.processed_items || 0);
		const months = Number(jobData.months || 6);
		let cursor = Number(jobData.cursor_pos || jobData.cursor || 0);
		if (jobData.status === 'done') {
			return res.json({ job_id, status: 'done', total_items: total, processed_items: processed, progress: total ? Math.round(processed * 100 / total) : 100 });
		}
		// ensure status running
		const jobsTbl = await getTableByName(appInst, jobsTableName);
		await jobsTbl.updateRow({ ROWID: jobROWID, status: 'running' });

	// Fetch only the items we need for this chunk to avoid full scans each run
		const batchSize = Number(req.query.batch || 15);
		const sliceRaw = await fetchBooksItemsPagedRange({ token, orgId, base: booksBase, start: cursor, count: batchSize, perPage: 200 });
		// If no items returned from the provider at this cursor, we're at the end — mark done.
		if (!Array.isArray(sliceRaw) || sliceRaw.length === 0) {
			const finalize = { ROWID: jobROWID, status: 'done', finished_at: dsNow(), processed_items: total, cursor_pos: total };
			await jobsTbl.updateRow(finalize);
			return res.json({ job_id, status: 'done', total_items: total, processed_items: total, progress: 100 });
		}
		// Early exclude non-orderable SKUs to skip expensive fetches, but still advance the cursor past them
		const slice = sliceRaw.filter(it => {
			const sku = String(it.sku || '').toLowerCase();
			return !(sku.startsWith('0-') || sku.startsWith('800-') || sku.startsWith('2000-'));
		});
		const skippedCount = Math.max(0, sliceRaw.length - slice.length);
		// Advance cursor/progress for skipped SKUs so we don't get stuck on them
		if (skippedCount > 0) {
			processed += skippedCount;
			cursor += skippedCount;
		}

		const from = new Date();
		from.setMonth(from.getMonth() - months);
		const fromDate = from.toISOString().slice(0, 10);
		const toDate = new Date().toISOString().slice(0, 10);

	const suggTbl = await getTableByName(appInst, suggTableName);
		const rowsToInsert = [];
		const conc = Math.max(1, Math.min(8, Number(req.query.conc || 6)));
		const groupSize = Math.max(1, Math.min(20, Number(req.query.group || 6)));
		const invoicePages = Math.max(1, Math.min(20, Number(req.query.invoicePages || 12)));
		// Micro-batch with timebox to avoid execution timeout
		for (let gi = 0; gi < slice.length; gi += groupSize) {
			const grp = slice.slice(gi, gi + groupSize);
			const results = await withConcurrency(grp, conc, async (it) => {
				try {
					let detail = it;
					// Prefer list-level available_stock when present to avoid detail call
					if (typeof it.available_stock === 'number') {
						detail = it;
					} else if (!Array.isArray(it.locations)) {
						try { detail = await fetchBooksItemDetail({ token, orgId, base: booksBase, itemId: it.item_id }); } catch (_) {}
					}
					const locations = Array.isArray(detail?.locations) ? detail.locations : [];
					const currentStock = (typeof detail?.available_stock === 'number')
						? Number(detail.available_stock)
						: locations.reduce((sum, loc) => sum + Number(loc.location_available_stock || loc.location_stock_on_hand || 0), 0);
					const sales = await fetchItemSalesHistoryBooks({ token, orgId, base: booksBase, itemId: it.item_id, fromDate, toDate, maxPages: invoicePages });
					const trend = calcTrendAndAvgMonthly(sales);
					const enriched = { ...it, stock_on_hand: currentStock, available_stock: currentStock };
					const norm = normalizeItem(enriched, trend);
					const suggestion = calculateOrderSuggestions([norm])[0];
					if (!suggestion) return null;
					const daysLeft = (suggestion.daysUntilStockout === null || !isFinite(suggestion.daysUntilStockout)) ? null : suggestion.daysUntilStockout;
					return {
						job_id,
						sku: suggestion.sku,
						description: suggestion.description,
						current_stock: suggestion.currentStock,
						suggested_quantity: suggestion.suggestedQuantity,
						priority_level: suggestion.priority,
						reason: suggestion.reason,
						estimated_cost: suggestion.estimatedCost,
						days_until_stockout: daysLeft,
						computed_at: dsNow()
					};
				} catch (_) { return null; }
			});
			for (const r of results) if (r) rowsToInsert.push(r);
			processed += grp.length;
			cursor += grp.length;
			if (Date.now() - started > 8500) break; // leave headroom under platform limit
		}
		if (rowsToInsert.length) {
			await suggTbl.insertRows(rowsToInsert);
		}
		// update job
		const update = { ROWID: jobROWID, processed_items: processed, cursor_pos: cursor };
		if (processed >= total) {
			update.status = 'done';
			update.finished_at = dsNow();
		}
		await jobsTbl.updateRow(update);

		const progress = total ? Math.min(100, Math.round(processed * 100 / total)) : 100;
		return res.json({ job_id, status: update.status || 'running', total_items: total, processed_items: processed, progress });
	} catch (e) {
		const msg = e && e.message ? String(e.message) : 'precompute run failed';
		return res.status(502).json({ error: msg });
	}
});

// Check job status
app.get('/precompute/status', async (req, res) => {
	try {
		if (process.env.ADMIN_TOKEN) {
			const h = req.headers['x-admin-token'];
			if (!h || String(h) !== String(process.env.ADMIN_TOKEN)) {
				return res.status(401).json({ error: 'Unauthorized' });
			}
		}
		const appInst = catalyst.initialize(req);
		const { jobsTable } = getEnvTableNames();
		const zcql = await getZcql(appInst);
		const job_id = String(req.query.job_id || '');
		if (!job_id) return res.status(400).json({ error: 'job_id required' });
		const rows = await zcql.executeZCQLQuery(`SELECT * FROM ${jobsTable} WHERE job_id='${job_id}'`);
		if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'job not found' });
		const job = rows[0][jobsTable];
		const total = Number(job.total_items || 0);
		const processed = Number(job.processed_items || 0);
		const progress = total ? Math.min(100, Math.round(processed * 100 / total)) : (job.status === 'done' ? 100 : 0);
		return res.json({ job_id, status: job.status, total_items: total, processed_items: processed, progress, started_at: job.started_at, finished_at: job.finished_at });
	} catch (e) {
		const msg = e && e.message ? String(e.message) : 'precompute status failed';
		return res.status(502).json({ error: msg });
	}
});

