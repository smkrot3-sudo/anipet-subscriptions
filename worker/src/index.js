const ORANGE_LEAD_DAYS = 3;
const RENEW_ADD_BAGS = 6;

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
	});
}

function error(message, status = 400) {
	return json({ error: message }, status);
}

function todayISO(tz = "Asia/Jerusalem") {
	const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
	return fmt.format(new Date());
}

function daysBetween(a, b) {
	const da = new Date(a + "T00:00:00Z");
	const db = new Date(b + "T00:00:00Z");
	return Math.round((db - da) / 86400000);
}

function addDaysISO(dateStr, days) {
	const d = new Date(dateStr + "T00:00:00Z");
	d.setUTCDate(d.getUTCDate() + Math.round(days));
	return d.toISOString().slice(0, 10);
}

function isValidDateStr(s) {
	return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
}

function computeEstimate(history) {
	// history: withdrawals for one customer, sorted ascending by taken_at
	if (history.length < 2) {
		return { avgIntervalDays: null, nextEstimate: null, lastWithdrawal: history[0]?.taken_at ?? null };
	}
	let totalGap = 0;
	for (let i = 1; i < history.length; i++) {
		totalGap += daysBetween(history[i - 1].taken_at, history[i].taken_at);
	}
	const avgIntervalDays = totalGap / (history.length - 1);
	const last = history[history.length - 1].taken_at;
	const nextEstimate = addDaysISO(last, avgIntervalDays);
	return { avgIntervalDays, nextEstimate, lastWithdrawal: last };
}

function colorFor(nextEstimate, today) {
	if (!nextEstimate) return "unknown";
	const diff = daysBetween(today, nextEstimate);
	if (diff <= 0) return "green";
	if (diff <= ORANGE_LEAD_DAYS) return "orange";
	return "red";
}

async function buildCustomerViews(db) {
	const today = todayISO();
	const { results: customers } = await db.prepare("SELECT * FROM customers ORDER BY id").all();
	const { results: withdrawals } = await db.prepare("SELECT * FROM withdrawals ORDER BY customer_id, taken_at").all();

	const byCustomer = new Map();
	for (const w of withdrawals) {
		if (!byCustomer.has(w.customer_id)) byCustomer.set(w.customer_id, []);
		byCustomer.get(w.customer_id).push(w);
	}

	return customers.map((c) => {
		const history = byCustomer.get(c.id) || [];
		const { avgIntervalDays, nextEstimate, lastWithdrawal } = computeEstimate(history);
		const waiting = !!c.waiting_until;
		return {
			id: c.id,
			name: c.name,
			phone: c.phone,
			bagsRemaining: c.bags_remaining,
			notes: c.notes || "",
			waitingUntil: c.waiting_until,
			historyCount: history.length,
			lastWithdrawal,
			avgIntervalDays: avgIntervalDays === null ? null : Math.round(avgIntervalDays * 10) / 10,
			nextEstimate,
			color: waiting ? "waiting" : colorFor(nextEstimate, today),
			isLastBag: c.bags_remaining <= 1,
			isWaiting: waiting,
			withdrawals: history.map((h) => ({ id: h.id, takenAt: h.taken_at, bags: h.bags })),
		};
	});
}

function splitGroups(views, today) {
	const colorRank = { green: 0, orange: 1, red: 2, unknown: 3 };

	const main = views
		.filter((v) => !v.isWaiting)
		.sort((a, b) => {
			const rankDiff = colorRank[a.color] - colorRank[b.color];
			if (rankDiff !== 0) return rankDiff;
			if (a.nextEstimate && b.nextEstimate) return a.nextEstimate < b.nextEstimate ? -1 : a.nextEstimate > b.nextEstimate ? 1 : 0;
			if (a.nextEstimate) return -1;
			if (b.nextEstimate) return 1;
			return a.name.localeCompare(b.name, "he");
		});

	const waitingList = views
		.filter((v) => v.isWaiting)
		.sort((a, b) => (a.waitingUntil < b.waitingUntil ? -1 : a.waitingUntil > b.waitingUntil ? 1 : 0))
		.map((v) => ({ ...v, readyToContact: v.waitingUntil <= today }));

	const lastBag = views
		.filter((v) => v.isLastBag && !v.isWaiting)
		.sort((a, b) => a.bagsRemaining - b.bagsRemaining || a.name.localeCompare(b.name, "he"));

	return { main, waitingList, lastBag };
}

async function handleRequest(request, env) {
	const url = new URL(request.url);
	const { pathname } = url;
	const db = env.DB;

	if (request.method === "OPTIONS") {
		return new Response(null, { headers: CORS_HEADERS });
	}

	// GET /api/customers  -> all groups, computed
	if (request.method === "GET" && pathname === "/api/customers") {
		const views = await buildCustomerViews(db);
		const groups = splitGroups(views, todayISO());
		return json(groups);
	}

	// POST /api/customers -> create new customer
	if (request.method === "POST" && pathname === "/api/customers") {
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name.trim()) {
			return error("שם לקוח הוא שדה חובה");
		}
		if (typeof body.phone !== "string" || !body.phone.trim()) {
			return error("מספר טלפון הוא שדה חובה");
		}
		const phone = body.phone.trim();
		const name = body.name.trim();
		const bagsRemaining = Number.isFinite(body.bagsRemaining) ? Math.max(0, Math.floor(body.bagsRemaining)) : 6;

		const existing = await db.prepare("SELECT id FROM customers WHERE phone = ?").bind(phone).first();
		if (existing) {
			return error("מספר הטלפון הזה כבר קיים במערכת - לא ניתן לצרף את אותו לקוח פעמיים", 409);
		}

		const result = await db
			.prepare("INSERT INTO customers (name, phone, bags_remaining) VALUES (?, ?, ?)")
			.bind(name, phone, bagsRemaining)
			.run();

		return json({ id: result.meta.last_row_id }, 201);
	}

	const idMatch = pathname.match(/^\/api\/customers\/(\d+)(?:\/(withdraw|wait|renew|unwait))?$/);
	if (idMatch) {
		const id = Number(idMatch[1]);
		const action = idMatch[2];

		const customer = await db.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
		if (!customer) return error("לקוח לא נמצא", 404);

		if (request.method === "PATCH" && !action) {
			const body = await request.json().catch(() => null);
			if (!body) return error("גוף בקשה לא תקין");
			const updates = [];
			const values = [];
			if (typeof body.name === "string" && body.name.trim()) {
				updates.push("name = ?");
				values.push(body.name.trim());
			}
			if (typeof body.phone === "string" && body.phone.trim()) {
				const phone = body.phone.trim();
				const clash = await db.prepare("SELECT id FROM customers WHERE phone = ? AND id != ?").bind(phone, id).first();
				if (clash) return error("מספר הטלפון הזה כבר שייך ללקוח אחר", 409);
				updates.push("phone = ?");
				values.push(phone);
			}
			if (Number.isFinite(body.bagsRemaining)) {
				updates.push("bags_remaining = ?");
				values.push(Math.max(0, Math.floor(body.bagsRemaining)));
			}
			if (typeof body.notes === "string") {
				updates.push("notes = ?");
				values.push(body.notes);
			}
			if (updates.length === 0) return error("אין מה לעדכן");
			updates.push("updated_at = datetime('now')");
			values.push(id);
			await db.prepare(`UPDATE customers SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
			return json({ ok: true });
		}

		if (request.method === "DELETE" && !action) {
			await db.prepare("DELETE FROM customers WHERE id = ?").bind(id).run();
			return json({ ok: true });
		}

		if (request.method === "POST" && action === "withdraw") {
			const body = await request.json().catch(() => ({}));
			const takenAt = isValidDateStr(body?.takenAt) ? body.takenAt : todayISO();
			const bags = Number.isFinite(body?.bags) && body.bags > 0 ? Math.floor(body.bags) : 1;

			await db.prepare("INSERT INTO withdrawals (customer_id, taken_at, bags) VALUES (?, ?, ?)").bind(id, takenAt, bags).run();
			const newRemaining = Math.max(0, customer.bags_remaining - bags);
			await db
				.prepare("UPDATE customers SET bags_remaining = ?, waiting_until = NULL, updated_at = datetime('now') WHERE id = ?")
				.bind(newRemaining, id)
				.run();
			return json({ ok: true, bagsRemaining: newRemaining });
		}

		if (request.method === "POST" && action === "wait") {
			const body = await request.json().catch(() => ({}));
			let followUpDate = null;
			if (isValidDateStr(body?.followUpDate)) {
				followUpDate = body.followUpDate;
			} else if (Number.isFinite(body?.days) && body.days >= 0) {
				followUpDate = addDaysISO(todayISO(), body.days);
			} else {
				followUpDate = addDaysISO(todayISO(), 7);
			}
			await db.prepare("UPDATE customers SET waiting_until = ?, updated_at = datetime('now') WHERE id = ?").bind(followUpDate, id).run();
			return json({ ok: true, waitingUntil: followUpDate });
		}

		if (request.method === "POST" && action === "unwait") {
			await db.prepare("UPDATE customers SET waiting_until = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run();
			return json({ ok: true });
		}

		if (request.method === "POST" && action === "renew") {
			const newRemaining = customer.bags_remaining + RENEW_ADD_BAGS;
			await db
				.prepare("UPDATE customers SET bags_remaining = ?, waiting_until = NULL, updated_at = datetime('now') WHERE id = ?")
				.bind(newRemaining, id)
				.run();
			return json({ ok: true, bagsRemaining: newRemaining });
		}

		return error("פעולה לא נתמכת", 405);
	}

	return error("לא נמצא", 404);
}

export default {
	async fetch(request, env) {
		try {
			return await handleRequest(request, env);
		} catch (err) {
			return error(`שגיאת שרת: ${err.message}`, 500);
		}
	},
};
