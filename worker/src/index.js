// Lead time scales with the customer's own pickup cadence, not a fixed
// number of days: a monthly buyer should hear from us ~5 days early, a
// weekly buyer shouldn't be "green" for most of their whole cycle.
const GREEN_LEAD_FRACTION = 1 / 6;
const ORANGE_LEAD_FRACTION = 1 / 3;
const MIN_GREEN_LEAD_DAYS = 2;
const MIN_ORANGE_EXTRA_DAYS = 3;
const RENEW_ADD_BAGS = 6;
const STUCK_AWAITING_DAYS = 3;

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

// Records a before-mutation snapshot of a customer row so the action can later be
// undone generically: restore every column from `before_state`, and delete any
// withdrawal rows the action created. `hardDelete` marks actions (just "create")
// where there is no prior row to restore to - undo means deleting the customer.
async function logActivity(db, customerBefore, action, summary, { createdWithdrawalIds = null, hardDelete = false } = {}) {
	const result = await db
		.prepare(
			"INSERT INTO activity_log (customer_id, customer_name, action, summary, before_state, created_withdrawal_ids, hard_delete) VALUES (?, ?, ?, ?, ?, ?, ?)"
		)
		.bind(
			customerBefore.id,
			customerBefore.name,
			action,
			summary,
			hardDelete ? null : JSON.stringify(customerBefore),
			createdWithdrawalIds ? JSON.stringify(createdWithdrawalIds) : null,
			hardDelete ? 1 : 0
		)
		.run();
	return result.meta.last_row_id;
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

function colorFor(nextEstimate, today, avgIntervalDays) {
	if (!nextEstimate) return "unknown";
	const diff = daysBetween(today, nextEstimate);
	const greenLead = Math.max(MIN_GREEN_LEAD_DAYS, Math.round((avgIntervalDays || 0) * GREEN_LEAD_FRACTION));
	const orangeLead = Math.max(greenLead + MIN_ORANGE_EXTRA_DAYS, Math.round((avgIntervalDays || 0) * ORANGE_LEAD_FRACTION));
	if (diff <= greenLead) return "green";
	if (diff <= orangeLead) return "orange";
	return "red";
}

async function buildCustomerViews(db) {
	const today = todayISO();
	const { results: customers } = await db.prepare("SELECT * FROM customers WHERE removed_at IS NULL ORDER BY id").all();
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
		const renewalWaiting = !!c.renewal_waiting_until;
		const awaitingReplyDays = c.awaiting_reply_at ? daysBetween(c.awaiting_reply_at.slice(0, 10), today) : null;
		return {
			id: c.id,
			name: c.name,
			phone: c.phone,
			bagsRemaining: c.bags_remaining,
			notes: c.notes || "",
			waitingUntil: c.waiting_until,
			waitNote: c.wait_note || "",
			renewalWaitingUntil: c.renewal_waiting_until,
			renewalWaitNote: c.renewal_wait_note || "",
			historyCount: history.length,
			lastWithdrawal,
			avgIntervalDays: avgIntervalDays === null ? null : Math.round(avgIntervalDays * 10) / 10,
			nextEstimate,
			color: waiting ? "waiting" : colorFor(nextEstimate, today, avgIntervalDays),
			isLastBag: c.bags_remaining <= 1,
			isWaiting: waiting,
			isRenewalWaiting: renewalWaiting,
			awaitingReply: !!c.awaiting_reply,
			awaitingReplyDays,
			awaitingReplyStuck: awaitingReplyDays !== null && awaitingReplyDays >= STUCK_AWAITING_DAYS,
			whatsappContactedAt: c.whatsapp_contacted_at,
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
		.filter((v) => v.isLastBag && !v.isWaiting && !v.isRenewalWaiting)
		.sort((a, b) => a.bagsRemaining - b.bagsRemaining || a.name.localeCompare(b.name, "he"));

	const lastBagWaitingList = views
		.filter((v) => v.isLastBag && !v.isWaiting && v.isRenewalWaiting)
		.sort((a, b) => (a.renewalWaitingUntil < b.renewalWaitingUntil ? -1 : a.renewalWaitingUntil > b.renewalWaitingUntil ? 1 : 0))
		.map((v) => ({ ...v, renewalReadyToContact: v.renewalWaitingUntil <= today }));

	return { main, waitingList, lastBag, lastBagWaitingList };
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

	// GET /api/activity -> recent activity log, newest first
	if (request.method === "GET" && pathname === "/api/activity") {
		const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 40));
		const { results } = await db.prepare("SELECT * FROM activity_log ORDER BY id DESC LIMIT ?").bind(limit).all();
		return json(
			results.map((r) => ({
				id: r.id,
				customerId: r.customer_id,
				customerName: r.customer_name,
				action: r.action,
				summary: r.summary,
				undone: !!r.undone,
				undoable: !r.undone,
				createdAt: r.created_at,
			}))
		);
	}

	// POST /api/activity/:id/undo -> reverse a logged action
	const undoMatch = pathname.match(/^\/api\/activity\/(\d+)\/undo$/);
	if (undoMatch && request.method === "POST") {
		const logId = Number(undoMatch[1]);
		const log = await db.prepare("SELECT * FROM activity_log WHERE id = ?").bind(logId).first();
		if (!log) return error("פעולה לא נמצאה", 404);
		if (log.undone) return error("הפעולה כבר בוטלה", 409);

		if (log.created_withdrawal_ids) {
			const ids = JSON.parse(log.created_withdrawal_ids);
			for (const wid of ids) {
				await db.prepare("DELETE FROM withdrawals WHERE id = ?").bind(wid).run();
			}
		}

		if (log.hard_delete) {
			await db.prepare("DELETE FROM withdrawals WHERE customer_id = ?").bind(log.customer_id).run();
			await db.prepare("DELETE FROM customers WHERE id = ?").bind(log.customer_id).run();
		} else if (log.before_state) {
			const snapshot = JSON.parse(log.before_state);
			const cols = Object.keys(snapshot).filter((k) => k !== "id");
			const setClause = cols.map((c) => `${c} = ?`).join(", ");
			await db
				.prepare(`UPDATE customers SET ${setClause} WHERE id = ?`)
				.bind(...cols.map((c) => snapshot[c]), log.customer_id)
				.run();
		}

		await db.prepare("UPDATE activity_log SET undone = 1 WHERE id = ?").bind(logId).run();
		return json({ ok: true });
	}

	// GET /api/stats -> dashboard numbers + a daily bags chart
	if (request.method === "GET" && pathname === "/api/stats") {
		const today = todayISO();
		const monthStart = today.slice(0, 7) + "-01";
		const fourteenDaysAgo = addDaysISO(today, -13);

		const totalActive = await db.prepare("SELECT COUNT(*) AS n FROM customers WHERE removed_at IS NULL").first();
		const bagsThisMonth = await db
			.prepare(
				"SELECT COALESCE(SUM(w.bags), 0) AS n FROM withdrawals w JOIN customers c ON c.id = w.customer_id WHERE w.taken_at >= ? AND c.removed_at IS NULL"
			)
			.bind(monthStart)
			.first();
		const newCustomersThisMonth = await db
			.prepare("SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?")
			.bind(monthStart)
			.first();
		const renewalsThisMonth = await db
			.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'renew' AND undone = 0 AND created_at >= ?")
			.bind(monthStart)
			.first();
		const { results: dailyRows } = await db
			.prepare(
				"SELECT w.taken_at AS day, COALESCE(SUM(w.bags), 0) AS bags FROM withdrawals w JOIN customers c ON c.id = w.customer_id WHERE w.taken_at >= ? AND c.removed_at IS NULL GROUP BY w.taken_at"
			)
			.bind(fourteenDaysAgo)
			.all();
		const dailyMap = new Map(dailyRows.map((r) => [r.day, r.bags]));
		const dailyBags = [];
		for (let i = 13; i >= 0; i--) {
			const day = addDaysISO(today, -i);
			dailyBags.push({ date: day, bags: dailyMap.get(day) || 0 });
		}

		const views = await buildCustomerViews(db);
		const stuckAwaiting = views.filter((v) => v.awaitingReplyStuck).length;

		return json({
			totalActive: totalActive.n,
			bagsThisMonth: bagsThisMonth.n,
			newCustomersThisMonth: newCustomersThisMonth.n,
			renewalsThisMonth: renewalsThisMonth.n,
			stuckAwaiting,
			dailyBags,
		});
	}

	// POST /api/customers -> create new customer (or reactivate a previously removed one)
	if (request.method === "POST" && pathname === "/api/customers") {
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name.trim()) {
			return error("שם לקוח הוא שדה חובה");
		}
		if (typeof body.phone !== "string" || !body.phone.trim()) {
			return error("מספר טלפון הוא שדה חובה");
		}
		const validDates = Array.isArray(body.history) ? body.history.filter(isValidDateStr) : [];
		if (validDates.length === 0) {
			return error("יש להזין לפחות תאריך משיכה קודם אחד");
		}
		const phone = body.phone.trim();
		const name = body.name.trim();
		const notes = typeof body.notes === "string" ? body.notes : "";
		const bagsRemaining = Number.isFinite(body.bagsRemaining) ? Math.max(0, Math.floor(body.bagsRemaining)) : 6;

		const existing = await db.prepare("SELECT * FROM customers WHERE phone = ?").bind(phone).first();

		if (existing && !existing.removed_at) {
			return error("מספר הטלפון הזה כבר קיים במערכת - לא ניתן לצרף את אותו לקוח פעמיים", 409);
		}

		if (existing && existing.removed_at) {
			if (!body.confirmReactivate) {
				return json(
					{
						error: "מספר הטלפון הזה הוסר בעבר מהמאגר",
						removed: true,
						removedCustomer: { id: existing.id, name: existing.name, removalReason: existing.removal_reason || "", removedAt: existing.removed_at },
					},
					409
				);
			}

			await db
				.prepare(
					"UPDATE customers SET name = ?, bags_remaining = ?, notes = ?, removed_at = NULL, removal_reason = NULL, waiting_until = NULL, updated_at = datetime('now') WHERE id = ?"
				)
				.bind(name, bagsRemaining, notes, existing.id)
				.run();
			const insertedIds = [];
			for (const takenAt of validDates) {
				const r = await db.prepare("INSERT INTO withdrawals (customer_id, taken_at, bags) VALUES (?, ?, 1)").bind(existing.id, takenAt).run();
				insertedIds.push(r.meta.last_row_id);
			}
			const activityLogId = await logActivity(db, existing, "reactivate", `הלקוח/ה הופעל/ה מחדש (${name})`, { createdWithdrawalIds: insertedIds });
			return json({ id: existing.id, reactivated: true, activityLogId }, 200);
		}

		const result = await db
			.prepare("INSERT INTO customers (name, phone, bags_remaining, notes) VALUES (?, ?, ?, ?)")
			.bind(name, phone, bagsRemaining, notes)
			.run();
		const customerId = result.meta.last_row_id;

		const insertedIds = [];
		for (const takenAt of validDates) {
			const r = await db.prepare("INSERT INTO withdrawals (customer_id, taken_at, bags) VALUES (?, ?, 1)").bind(customerId, takenAt).run();
			insertedIds.push(r.meta.last_row_id);
		}

		const activityLogId = await logActivity(db, { id: customerId, name }, "create", `לקוח/ה חדש/ה נוסף/ה: ${name}`, {
			createdWithdrawalIds: insertedIds,
			hardDelete: true,
		});

		return json({ id: customerId, activityLogId }, 201);
	}

	const idMatch = pathname.match(/^\/api\/customers\/(\d+)(?:\/(withdraw|wait|renew|unwait|renewal-wait|renewal-unwait))?$/);
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
			let summary = "פרטי הלקוח עודכנו";
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
			if (typeof body.awaitingReply === "boolean") {
				updates.push("awaiting_reply = ?");
				values.push(body.awaitingReply ? 1 : 0);
				updates.push("awaiting_reply_at = ?");
				values.push(body.awaitingReply ? todayISO() : null);
				summary = body.awaitingReply ? "סומן כממתין לתשובה" : "סימון ממתין לתשובה בוטל";
			}
			if (body.markWhatsappContacted === true) {
				updates.push("whatsapp_contacted_at = COALESCE(whatsapp_contacted_at, datetime('now'))");
				summary = "נשלחה הודעת וואטסאפ";
			}
			if (updates.length === 0) return error("אין מה לעדכן");
			updates.push("updated_at = datetime('now')");
			values.push(id);
			const activityLogId = await logActivity(db, customer, "edit", summary);
			await db.prepare(`UPDATE customers SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
			return json({ ok: true, activityLogId });
		}

		if (request.method === "DELETE" && !action) {
			const body = await request.json().catch(() => ({}));
			const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
			const activityLogId = await logActivity(db, customer, "delete", `הלקוח/ה הוסר/ה מהמאגר${reason ? ` (${reason})` : ""}`);
			await db
				.prepare("UPDATE customers SET removed_at = datetime('now'), removal_reason = ?, waiting_until = NULL, updated_at = datetime('now') WHERE id = ?")
				.bind(reason, id)
				.run();
			return json({ ok: true, activityLogId });
		}

		if (request.method === "POST" && action === "withdraw") {
			const body = await request.json().catch(() => ({}));
			const takenAt = isValidDateStr(body?.takenAt) ? body.takenAt : todayISO();
			const bags = Number.isFinite(body?.bags) && body.bags > 0 ? Math.floor(body.bags) : 1;

			const wResult = await db.prepare("INSERT INTO withdrawals (customer_id, taken_at, bags) VALUES (?, ?, ?)").bind(id, takenAt, bags).run();
			const activityLogId = await logActivity(db, customer, "withdraw", `נרשמה משיכה של ${bags} ${bags === 1 ? "שק" : "שקים"}`, {
				createdWithdrawalIds: [wResult.meta.last_row_id],
			});
			const newRemaining = Math.max(0, customer.bags_remaining - bags);
			await db
				.prepare("UPDATE customers SET bags_remaining = ?, waiting_until = NULL, awaiting_reply = 0, awaiting_reply_at = NULL, updated_at = datetime('now') WHERE id = ?")
				.bind(newRemaining, id)
				.run();
			return json({ ok: true, bagsRemaining: newRemaining, activityLogId });
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
			const note = typeof body?.note === "string" ? body.note.trim() : "";
			const activityLogId = await logActivity(db, customer, "wait", `הועבר/ה להמתנה עד ${followUpDate}`);
			await db
				.prepare("UPDATE customers SET waiting_until = ?, wait_note = ?, awaiting_reply = 0, awaiting_reply_at = NULL, updated_at = datetime('now') WHERE id = ?")
				.bind(followUpDate, note, id)
				.run();
			return json({ ok: true, waitingUntil: followUpDate, activityLogId });
		}

		if (request.method === "POST" && action === "unwait") {
			const activityLogId = await logActivity(db, customer, "unwait", "הוחזר/ה למעקב הרגיל");
			await db.prepare("UPDATE customers SET waiting_until = NULL, wait_note = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run();
			return json({ ok: true, activityLogId });
		}

		if (request.method === "POST" && action === "renew") {
			const body = await request.json().catch(() => ({}));
			const bagsToAdd = Number.isFinite(body?.bagsToAdd) && body.bagsToAdd >= 0 ? Math.floor(body.bagsToAdd) : RENEW_ADD_BAGS;
			const newRemaining = customer.bags_remaining + bagsToAdd;
			const activityLogId = await logActivity(db, customer, "renew", `המנוי חודש (+${bagsToAdd} שקים)`);
			await db
				.prepare(
					"UPDATE customers SET bags_remaining = ?, waiting_until = NULL, renewal_waiting_until = NULL, renewal_wait_note = NULL, awaiting_reply = 0, awaiting_reply_at = NULL, updated_at = datetime('now') WHERE id = ?"
				)
				.bind(newRemaining, id)
				.run();
			return json({ ok: true, bagsRemaining: newRemaining, activityLogId });
		}

		if (request.method === "POST" && action === "renewal-wait") {
			const body = await request.json().catch(() => ({}));
			let followUpDate = null;
			if (isValidDateStr(body?.followUpDate)) {
				followUpDate = body.followUpDate;
			} else if (Number.isFinite(body?.days) && body.days >= 0) {
				followUpDate = addDaysISO(todayISO(), body.days);
			} else {
				followUpDate = addDaysISO(todayISO(), 7);
			}
			const note = typeof body?.note === "string" ? body.note.trim() : "";
			const activityLogId = await logActivity(db, customer, "renewal-wait", `הועבר/ה לממתינים לחידוש עד ${followUpDate}`);
			await db
				.prepare(
					"UPDATE customers SET renewal_waiting_until = ?, renewal_wait_note = ?, awaiting_reply = 0, awaiting_reply_at = NULL, updated_at = datetime('now') WHERE id = ?"
				)
				.bind(followUpDate, note, id)
				.run();
			return json({ ok: true, renewalWaitingUntil: followUpDate, activityLogId });
		}

		if (request.method === "POST" && action === "renewal-unwait") {
			const activityLogId = await logActivity(db, customer, "renewal-unwait", "הוחזר/ה לרשימת החידוש הרגילה");
			await db
				.prepare("UPDATE customers SET renewal_waiting_until = NULL, renewal_wait_note = NULL, updated_at = datetime('now') WHERE id = ?")
				.bind(id)
				.run();
			return json({ ok: true, activityLogId });
		}

		return error("פעולה לא נתמכת", 405);
	}

	const withdrawalMatch = pathname.match(/^\/api\/customers\/(\d+)\/withdrawals\/(\d+)$/);
	if (withdrawalMatch) {
		const customerId = Number(withdrawalMatch[1]);
		const withdrawalId = Number(withdrawalMatch[2]);
		const withdrawal = await db
			.prepare("SELECT * FROM withdrawals WHERE id = ? AND customer_id = ?")
			.bind(withdrawalId, customerId)
			.first();
		if (!withdrawal) return error("משיכה לא נמצאה", 404);

		if (request.method === "PATCH") {
			const body = await request.json().catch(() => null);
			if (!body || !isValidDateStr(body.takenAt)) return error("תאריך לא תקין");
			await db.prepare("UPDATE withdrawals SET taken_at = ? WHERE id = ?").bind(body.takenAt, withdrawalId).run();
			return json({ ok: true });
		}

		if (request.method === "DELETE") {
			await db.prepare("DELETE FROM withdrawals WHERE id = ?").bind(withdrawalId).run();
			const customer = await db.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first();
			if (customer) {
				const restored = customer.bags_remaining + withdrawal.bags;
				await db.prepare("UPDATE customers SET bags_remaining = ?, updated_at = datetime('now') WHERE id = ?").bind(restored, customerId).run();
			}
			return json({ ok: true });
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
