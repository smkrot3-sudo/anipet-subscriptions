const API = window.API_BASE_URL;

function todayISO() {
	return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const el = {
	mainBody: document.querySelector("#table-main tbody"),
	waitingBody: document.querySelector("#table-waiting tbody"),
	lastBagBody: document.querySelector("#table-lastbag tbody"),
	lastBagWaitingBody: document.querySelector("#table-lastbag-waiting tbody"),
	toast: document.getElementById("toast"),
	modalBackdrop: document.getElementById("modal-backdrop"),
	modal: document.getElementById("modal"),
	search: document.getElementById("search-box"),
	sort: document.getElementById("sort-select"),
};

function showToast(message, isError = false) {
	el.toast.textContent = message;
	el.toast.classList.remove("hidden");
	el.toast.classList.toggle("error", isError);
	clearTimeout(showToast._t);
	showToast._t = setTimeout(() => el.toast.classList.add("hidden"), 3500);
}

function closeModal() {
	el.modalBackdrop.classList.add("hidden");
	el.modal.innerHTML = "";
}

function openModal(html, onMount) {
	el.modal.innerHTML = html;
	el.modalBackdrop.classList.remove("hidden");
	if (onMount) onMount(el.modal);
}

el.modalBackdrop.addEventListener("click", (e) => {
	if (e.target === el.modalBackdrop) closeModal();
});

async function api(path, options = {}) {
	const res = await fetch(`${API}${path}`, {
		method: options.method || "GET",
		headers: options.body ? { "Content-Type": "application/json" } : undefined,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data.error || `שגיאה (${res.status})`);
		Object.assign(err, data);
		throw err;
	}
	return data;
}

function toWhatsappLink(phone, message) {
	let digits = (phone || "").replace(/[^\d]/g, "");
	if (digits.startsWith("0")) digits = "972" + digits.slice(1);
	const text = encodeURIComponent(message || "");
	return `whatsapp://send?phone=${digits}${text ? `&text=${text}` : ""}`;
}

function copyIcon() {
	return `<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 10V3.5A1.5 1.5 0 0 1 4 2h6.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
}

async function copyToClipboard(text) {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			// fall through to the legacy fallback below
		}
	}
	const input = document.createElement("textarea");
	input.value = text;
	input.style.position = "fixed";
	input.style.opacity = "0";
	document.body.appendChild(input);
	input.focus();
	input.select();
	const ok = document.execCommand("copy");
	document.body.removeChild(input);
	if (!ok) throw new Error("copy failed");
}

function phoneCell(phone) {
	return `<span class="phone-cell">
		<a class="phone-link" href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>
		<button type="button" class="icon-btn" data-action="copy-phone" data-phone="${escapeHtml(phone)}" title="העתקת מספר טלפון" aria-label="העתקת מספר טלפון">${copyIcon()}</button>
	</span>`;
}

function fmtDate(d) {
	if (!d) return "-";
	const [y, m, day] = d.split("-");
	return `${day}/${m}/${y}`;
}

function colorLabel(color) {
	return { green: "row-green", orange: "row-orange", red: "row-red", unknown: "row-unknown", waiting: "" }[color] || "";
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const STATUS_LABELS = {
	green: "אפשר עכשיו",
	orange: "בקרוב",
	red: "יש זמן",
	unknown: "אין נתונים",
};

function statusChip(color, label) {
	return `<span class="status-chip"><i class="dot dot-${color}"></i>${label || STATUS_LABELS[color] || ""}</span>`;
}

function bagGauge(id, bagsRemaining) {
	const ratio = Math.max(0, Math.min(1, bagsRemaining / 6));
	const w = 13, h = 16, fillH = Math.round(h * ratio), y = h - fillH;
	const clipId = `bag-clip-${id}`;
	return `<span class="bag-gauge">
		<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
			<defs><clipPath id="${clipId}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="3" /></clipPath></defs>
			<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="3" fill="var(--surface-2)" stroke="var(--border-strong)" />
			<g clip-path="url(#${clipId})"><rect x="0" y="${y}" width="${w}" height="${fillH}" fill="var(--ink-secondary)" /></g>
		</svg>
		${bagsRemaining}
	</span>`;
}

let allGroups = { main: [], waitingList: [], lastBag: [], lastBagWaitingList: [] };

async function refresh() {
	try {
		allGroups = await api("/api/customers");
		renderStatStrip();
		updateNav();
		applyFilter();
	} catch (err) {
		showToast(err.message, true);
	}
}

function updateNav() {
	const readyNow = allGroups.main.filter((c) => c.color === "green").length;
	const soon = allGroups.main.filter((c) => c.color === "orange").length;
	const waitingReady = allGroups.waitingList.filter((c) => c.readyToContact).length;
	const lastBagCount = allGroups.lastBag.length;
	const renewalWaitingReady = allGroups.lastBagWaitingList.filter((c) => c.renewalReadyToContact).length;

	const waitingBadge = document.getElementById("badge-waiting");
	waitingBadge.textContent = String(waitingReady);
	waitingBadge.hidden = waitingReady === 0;

	const lastBagTotal = lastBagCount + renewalWaitingReady;
	const lastBagBadge = document.getElementById("badge-lastbag");
	lastBagBadge.textContent = String(lastBagTotal);
	lastBagBadge.hidden = lastBagTotal === 0;

	document.getElementById("tooltip-main").textContent =
		readyNow || soon
			? `${readyNow} אפשר לשלוח להם הודעה כבר עכשיו, ועוד ${soon} בקרוב.`
			: "אין כרגע לקוחות שצריך לשלוח להם הודעה.";

	document.getElementById("tooltip-waiting").textContent =
		waitingReady > 0
			? `יש ${waitingReady} אנשים שאפשר לחזור אליהם עכשיו, אחרי שהתאריך שסימנתם עבורם הגיע.`
			: "אין כרגע אנשים שצריך לחזור אליהם - כולם עדיין בתקופת ההמתנה שסומנה.";

	document.getElementById("tooltip-lastbag").textContent =
		lastBagCount > 0 || renewalWaitingReady > 0
			? `יש ${lastBagCount} לקוחות שאפשר להציע להם לחדש עכשיו${renewalWaitingReady > 0 ? `, ועוד ${renewalWaitingReady} שאפשר לחזור אליהם לגבי חידוש` : ""}.`
			: "אין כרגע לקוחות שצריכים חידוש מנוי.";
}

const PAGES = ["main", "waiting", "lastbag"];

function viewFromHash() {
	const v = (location.hash || "").replace("#", "");
	return PAGES.includes(v) ? v : "main";
}

function showPage(view) {
	if (!PAGES.includes(view)) view = "main";
	document.querySelectorAll(".page").forEach((el) => el.classList.toggle("active", el.dataset.page === view));
	document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
	btn.addEventListener("click", () => {
		location.hash = btn.dataset.view;
	});
});
window.addEventListener("hashchange", () => showPage(viewFromHash()));
showPage(viewFromHash());

function renderStatStrip() {
	const readyNow = allGroups.main.filter((c) => c.color === "green").length;
	const soon = allGroups.main.filter((c) => c.color === "orange").length;
	const waiting = allGroups.waitingList.length;
	const renew = allGroups.lastBag.length;
	document.getElementById("stat-strip").innerHTML = `
		<div class="stat-tile stat-green"><span class="stat-value">${readyNow}</span><span class="stat-label">אפשר לשלוח עכשיו</span></div>
		<div class="stat-tile stat-orange"><span class="stat-value">${soon}</span><span class="stat-label">בקרוב</span></div>
		<div class="stat-tile stat-waiting"><span class="stat-value">${waiting}</span><span class="stat-label">ממתינים</span></div>
		<div class="stat-tile stat-renew"><span class="stat-value">${renew}</span><span class="stat-label">לחדש מנוי</span></div>`;
}

let statusFilter = null;

function sortMainRows(rows, mode) {
	const copy = [...rows];
	if (mode === "name") return copy.sort((a, b) => a.name.localeCompare(b.name, "he"));
	if (mode === "bags") return copy.sort((a, b) => a.bagsRemaining - b.bagsRemaining);
	if (mode === "date") {
		return copy.sort((a, b) => {
			if (a.nextEstimate && b.nextEstimate) return a.nextEstimate < b.nextEstimate ? -1 : a.nextEstimate > b.nextEstimate ? 1 : 0;
			if (a.nextEstimate) return -1;
			if (b.nextEstimate) return 1;
			return 0;
		});
	}
	return copy; // "urgency" - the server already returns this order
}

const MAIN_PAGE_SIZE = 25;
let mainPage = 1;

function applyFilter() {
	const q = (el.search.value || "").trim().toLowerCase();
	const match = (c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q);

	let main = allGroups.main.filter(match);
	if (statusFilter) main = main.filter((c) => c.color === statusFilter);
	main = sortMainRows(main, el.sort.value);

	const totalPages = Math.max(1, Math.ceil(main.length / MAIN_PAGE_SIZE));
	if (mainPage > totalPages) mainPage = totalPages;
	if (mainPage < 1) mainPage = 1;
	const pageRows = main.slice((mainPage - 1) * MAIN_PAGE_SIZE, mainPage * MAIN_PAGE_SIZE);

	renderMain(pageRows);
	renderMainPagination(main.length, totalPages);
	renderWaiting(allGroups.waitingList.filter(match));
	renderLastBag(allGroups.lastBag.filter(match));
	renderLastBagWaiting(allGroups.lastBagWaitingList.filter(match));

	document.querySelectorAll(".legend-chip").forEach((chip) => {
		chip.classList.toggle("active", chip.dataset.filter === statusFilter);
	});
}

function renderMainPagination(total, totalPages) {
	const wrap = document.getElementById("main-pagination");
	if (totalPages <= 1) {
		wrap.innerHTML = "";
		return;
	}
	wrap.innerHTML = `
		<button type="button" class="btn" id="main-prev"${mainPage <= 1 ? " disabled" : ""}>הקודם</button>
		<span class="pagination-label">עמוד ${mainPage} מתוך ${totalPages} (${total} לקוחות)</span>
		<button type="button" class="btn" id="main-next"${mainPage >= totalPages ? " disabled" : ""}>הבא</button>`;
	wrap.querySelector("#main-prev")?.addEventListener("click", () => {
		mainPage--;
		applyFilter();
		document.querySelector(".page.active")?.scrollIntoView({ behavior: "smooth", block: "start" });
	});
	wrap.querySelector("#main-next")?.addEventListener("click", () => {
		mainPage++;
		applyFilter();
		document.querySelector(".page.active")?.scrollIntoView({ behavior: "smooth", block: "start" });
	});
}

el.search.addEventListener("input", () => {
	mainPage = 1;
	applyFilter();
});
el.sort.addEventListener("change", () => {
	mainPage = 1;
	applyFilter();
});

document.querySelectorAll(".legend-chip").forEach((chip) => {
	chip.addEventListener("click", () => {
		statusFilter = statusFilter === chip.dataset.filter ? null : chip.dataset.filter;
		mainPage = 1;
		applyFilter();
	});
});

function notesLine(c) {
	return c.notes ? `<div class="notes-line">${escapeHtml(c.notes)}</div>` : "";
}

function waitNoteLine(note) {
	return note ? `<div class="notes-line">למה ממתינים: ${escapeHtml(note)}</div>` : "";
}

function awaitingBadge(c) {
	return c.awaitingReply ? '<span class="awaiting-badge">ממתין לתשובה</span>' : "";
}

function awaitingButton(c) {
	return `<button class="btn" data-action="toggle-awaiting" data-id="${c.id}">${c.awaitingReply ? "בטל סימון תשובה" : "סימון: ממתין לתשובה"}</button>`;
}

function renderMain(rows) {
	document.querySelector("#table-main").parentElement.nextElementSibling.classList.toggle("hidden", rows.length > 0);
	el.mainBody.innerHTML = rows
		.map(
			(c) => `
		<tr class="${colorLabel(c.color)}">
			<td class="name-cell">
				<div class="name-line">${statusChip(c.color)}${awaitingBadge(c)}<span>${escapeHtml(c.name)}</span></div>
				${notesLine(c)}
			</td>
			<td data-label="טלפון">${phoneCell(c.phone)}</td>
			<td data-label="שקים שנשארו">${bagGauge(c.id, c.bagsRemaining)}</td>
			<td data-label="משיכה אחרונה" class="date-cell">${fmtDate(c.lastWithdrawal)}</td>
			<td data-label="תאריך משוער הבא" class="date-cell">${fmtDate(c.nextEstimate)}</td>
			<td class="actions-cell">
				<button class="btn btn-whatsapp" data-action="whatsapp" data-template="reminder" data-id="${c.id}">וואטסאפ</button>
				<button class="btn" data-action="withdraw" data-id="${c.id}">סימון משיכה</button>
				<button class="btn" data-action="wait" data-id="${c.id}">עדיין לא צריך</button>
				${awaitingButton(c)}
				<button class="btn" data-action="history" data-id="${c.id}">היסטוריה</button>
				<button class="btn" data-action="edit" data-id="${c.id}">עריכה</button>
				<button class="btn btn-danger" data-action="delete" data-id="${c.id}">מחיקה</button>
			</td>
		</tr>`
		)
		.join("");
}

function renderWaiting(rows) {
	document.querySelector("#table-waiting").parentElement.nextElementSibling.classList.toggle("hidden", rows.length > 0);
	el.waitingBody.innerHTML = rows
		.map(
			(c) => `
		<tr class="${c.readyToContact ? "row-green" : ""}">
			<td class="name-cell">
				<div class="name-line">${statusChip(c.readyToContact ? "green" : "unknown", c.readyToContact ? "מוכן לחזרה" : "בהמתנה")}${awaitingBadge(c)}<span>${escapeHtml(c.name)}</span></div>
				${notesLine(c)}
				${waitNoteLine(c.waitNote)}
			</td>
			<td data-label="טלפון">${phoneCell(c.phone)}</td>
			<td data-label="לחזור אליו בתאריך" class="date-cell">${fmtDate(c.waitingUntil)}</td>
			<td class="actions-cell">
				<button class="btn btn-whatsapp" data-action="whatsapp" data-template="waiting" data-id="${c.id}">וואטסאפ</button>
				<button class="btn" data-action="withdraw" data-id="${c.id}">משך שק</button>
				<button class="btn" data-action="extend-wait" data-id="${c.id}">הארכת המתנה</button>
				${awaitingButton(c)}
				<button class="btn" data-action="unwait" data-id="${c.id}">חזרה למעקב רגיל</button>
			</td>
		</tr>`
		)
		.join("");
}

function renderLastBag(rows) {
	document.querySelector("#table-lastbag").parentElement.nextElementSibling.classList.toggle("hidden", rows.length > 0);
	el.lastBagBody.innerHTML = rows
		.map(
			(c) => `
		<tr class="${c.bagsRemaining === 0 ? "row-red" : "row-orange"}">
			<td class="name-cell">
				<div class="name-line">${statusChip(c.bagsRemaining === 0 ? "red" : "orange", c.bagsRemaining === 0 ? "אין שקים" : "שק אחרון")}${awaitingBadge(c)}<span>${escapeHtml(c.name)}</span></div>
				${notesLine(c)}
			</td>
			<td data-label="טלפון">${phoneCell(c.phone)}</td>
			<td data-label="שקים שנשארו">${bagGauge(c.id, c.bagsRemaining)}</td>
			<td class="actions-cell">
				<button class="btn btn-whatsapp" data-action="whatsapp" data-template="renew" data-id="${c.id}">וואטסאפ</button>
				<button class="btn btn-primary" data-action="renew" data-id="${c.id}">חודש</button>
				<button class="btn" data-action="renewal-wait" data-id="${c.id}">לחזור אליו בעוד כמה ימים</button>
				${awaitingButton(c)}
			</td>
		</tr>`
		)
		.join("");
}

function renderLastBagWaiting(rows) {
	document.querySelector("#table-lastbag-waiting").parentElement.nextElementSibling.classList.toggle("hidden", rows.length > 0);
	el.lastBagWaitingBody.innerHTML = rows
		.map(
			(c) => `
		<tr class="${c.renewalReadyToContact ? "row-green" : ""}">
			<td class="name-cell">
				<div class="name-line">${statusChip(c.renewalReadyToContact ? "green" : "unknown", c.renewalReadyToContact ? "מוכן לחזרה" : "בהמתנה")}${awaitingBadge(c)}<span>${escapeHtml(c.name)}</span></div>
				${notesLine(c)}
				${waitNoteLine(c.renewalWaitNote)}
			</td>
			<td data-label="טלפון">${phoneCell(c.phone)}</td>
			<td data-label="לחזור אליו בתאריך" class="date-cell">${fmtDate(c.renewalWaitingUntil)}</td>
			<td class="actions-cell">
				<button class="btn btn-whatsapp" data-action="whatsapp" data-template="renew" data-id="${c.id}">וואטסאפ</button>
				<button class="btn btn-primary" data-action="renew" data-id="${c.id}">חודש</button>
				${awaitingButton(c)}
				<button class="btn" data-action="renewal-unwait" data-id="${c.id}">חזרה לרשימת החידוש</button>
			</td>
		</tr>`
		)
		.join("");
}

function findCustomer(id) {
	return (
		allGroups.main.find((r) => r.id === id) ||
		allGroups.waitingList.find((r) => r.id === id) ||
		allGroups.lastBag.find((r) => r.id === id) ||
		allGroups.lastBagWaitingList.find((r) => r.id === id)
	);
}

document.getElementById("btn-add-customer").addEventListener("click", () => {
	openModal(
		`
		<h3>צירוף לקוח חדש</h3>
		<div class="field">
			<label>שם הלקוח</label>
			<input type="text" id="f-name" />
		</div>
		<div class="field">
			<label>מספר טלפון</label>
			<input type="tel" id="f-phone" placeholder="05X-XXXXXXX" />
			<div class="field-error" id="f-phone-err"></div>
		</div>
		<div class="field">
			<label>מספר שקים שנשארו במנוי</label>
			<input type="number" id="f-bags" value="6" min="0" />
		</div>
		<div class="field">
			<label>תאריכי משיכות קודמות (חובה - לפחות תאריך אחד, עוזר לחשב תדירות)</label>
			<div id="f-history-rows"></div>
			<button type="button" class="btn" id="f-add-history">+ הוסף תאריך</button>
		</div>
		<div class="field">
			<label>הערות (לא חובה)</label>
			<textarea id="f-notes" rows="2"></textarea>
		</div>
		<div class="modal-actions">
			<button class="btn btn-primary" id="f-submit">הוספה</button>
			<button class="btn" id="f-cancel">ביטול</button>
		</div>`,
		(modal) => {
			const rowsWrap = modal.querySelector("#f-history-rows");
			function addHistoryRow() {
				const row = document.createElement("div");
				row.className = "history-row";
				row.innerHTML = `<input type="date" class="f-history-date" max="${todayISO()}" /><button type="button" class="btn btn-danger">הסר</button>`;
				row.querySelector("button").addEventListener("click", () => row.remove());
				rowsWrap.appendChild(row);
			}
			addHistoryRow();
			modal.querySelector("#f-add-history").addEventListener("click", addHistoryRow);

			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.querySelector("#f-submit").addEventListener("click", async () => {
				const name = modal.querySelector("#f-name").value.trim();
				const phone = modal.querySelector("#f-phone").value.trim();
				const bagsRemaining = Number(modal.querySelector("#f-bags").value);
				const notes = modal.querySelector("#f-notes").value.trim();
				const history = Array.from(modal.querySelectorAll(".f-history-date")).map((i) => i.value).filter(Boolean);
				const errBox = modal.querySelector("#f-phone-err");
				errBox.textContent = "";
				if (!name || !phone) {
					errBox.textContent = "שם וטלפון הם שדות חובה";
					return;
				}
				if (history.length === 0) {
					errBox.textContent = "יש להזין לפחות תאריך משיכה קודם אחד";
					return;
				}
				await submitNewCustomer({ name, phone, bagsRemaining, notes, history }, errBox);
			});
		}
	);
});

async function submitNewCustomer(payload, errBox) {
	try {
		await api("/api/customers", { method: "POST", body: payload });
		closeModal();
		showToast("הלקוח נוסף בהצלחה");
		refresh();
	} catch (err) {
		if (err.removed) {
			const r = err.removedCustomer;
			const reasonText = r.removalReason ? `\nסיבת ההסרה שנרשמה: ${r.removalReason}` : "\n(לא נרשמה סיבת הסרה)";
			const confirmed = confirm(`מספר הטלפון הזה שייך ל"${r.name}", שהוסר/ה בעבר מהמאגר.${reasonText}\n\nלהוסיף אותו/ה מחדש?`);
			if (confirmed) {
				await submitNewCustomer({ ...payload, confirmReactivate: true }, errBox);
			}
			return;
		}
		errBox.textContent = err.message;
	}
}

function openWithdrawModal(id) {
	const today = todayISO();
	openModal(
		`
		<h3>סימון משיכת שק</h3>
		<div class="field">
			<label>כמה שקים נמשכו?</label>
			<input type="number" id="f-count" value="1" min="1" />
		</div>
		<div class="field">
			<label>תאריך המשיכה</label>
			<input type="date" id="f-date" value="${today}" />
		</div>
		<div class="modal-actions">
			<button class="btn btn-primary" id="f-submit">שמירה</button>
			<button class="btn" id="f-cancel">ביטול</button>
		</div>`,
		(modal) => {
			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.querySelector("#f-submit").addEventListener("click", async () => {
				const bags = Number(modal.querySelector("#f-count").value) || 1;
				const takenAt = modal.querySelector("#f-date").value || today;
				try {
					await api(`/api/customers/${id}/withdraw`, { method: "POST", body: { bags, takenAt } });
					closeModal();
					showToast("המשיכה נרשמה");
					refresh();
				} catch (err) {
					showToast(err.message, true);
				}
			});
		}
	);
}

function openWaitModal(id, { isExtend = false, mode = "main" } = {}) {
	const endpoint = mode === "renewal" ? "renewal-wait" : "wait";
	const titles = {
		main: isExtend ? "הארכת זמן המתנה" : "הלקוח עדיין לא צריך שק",
		renewal: "לחזור אל הלקוח בעניין החידוש",
	};
	openModal(
		`
		<h3>${titles[mode]}</h3>
		<div class="field">
			<label>לחזור אליו בעוד כמה ימים (מהיום)?</label>
			<input type="number" id="f-days" value="7" min="0" />
		</div>
		<div class="field">
			<label>הערה (לא חובה)</label>
			<textarea id="f-note" rows="2" placeholder="למשל: ביקש/ה לחשוב על זה"></textarea>
		</div>
		<div class="modal-actions">
			<button class="btn btn-primary" id="f-submit">שמירה</button>
			<button class="btn" id="f-cancel">ביטול</button>
		</div>`,
		(modal) => {
			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.querySelector("#f-submit").addEventListener("click", async () => {
				const days = Number(modal.querySelector("#f-days").value) || 0;
				const note = modal.querySelector("#f-note").value.trim();
				try {
					await api(`/api/customers/${id}/${endpoint}`, { method: "POST", body: { days, note } });
					closeModal();
					showToast(mode === "renewal" ? "הלקוח הועבר לממתינים לחידוש" : "הלקוח הועבר לרשימת ההמתנה");
					refresh();
				} catch (err) {
					showToast(err.message, true);
				}
			});
		}
	);
}

function openEditModal(id) {
	const c = findCustomer(id);
	if (!c) return;
	openModal(
		`
		<h3>עריכת לקוח</h3>
		<div class="field">
			<label>שם הלקוח</label>
			<input type="text" id="f-name" value="${escapeHtml(c.name)}" />
		</div>
		<div class="field">
			<label>מספר טלפון</label>
			<input type="tel" id="f-phone" value="${escapeHtml(c.phone)}" />
			<div class="field-error" id="f-err"></div>
		</div>
		<div class="field">
			<label>מספר שקים שנשארו</label>
			<input type="number" id="f-bags" value="${c.bagsRemaining}" min="0" />
		</div>
		<div class="field">
			<label>הערות</label>
			<textarea id="f-notes" rows="2">${escapeHtml(c.notes || "")}</textarea>
		</div>
		<div class="modal-actions">
			<button class="btn btn-primary" id="f-submit">שמירה</button>
			<button class="btn" id="f-cancel">ביטול</button>
		</div>`,
		(modal) => {
			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.querySelector("#f-submit").addEventListener("click", async () => {
				const name = modal.querySelector("#f-name").value.trim();
				const phone = modal.querySelector("#f-phone").value.trim();
				const bagsRemaining = Number(modal.querySelector("#f-bags").value);
				const notes = modal.querySelector("#f-notes").value.trim();
				try {
					await api(`/api/customers/${id}`, { method: "PATCH", body: { name, phone, bagsRemaining, notes } });
					closeModal();
					showToast("הפרטים עודכנו");
					refresh();
				} catch (err) {
					modal.querySelector("#f-err").textContent = err.message;
				}
			});
		}
	);
}

function renderHistoryRows(modal, customer) {
	const wrap = modal.querySelector("#history-list");
	const sorted = [...customer.withdrawals].sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1));
	wrap.innerHTML =
		sorted
			.map(
				(w) => `
		<div class="history-row" data-wid="${w.id}">
			<input type="date" class="hist-date" value="${w.takenAt}" max="${todayISO()}" />
			<span class="hist-bags">${w.bags} ${w.bags === 1 ? "שק" : "שקים"}</span>
			<button type="button" class="btn" data-hist-save="${w.id}">שמירה</button>
			<button type="button" class="btn btn-danger" data-hist-del="${w.id}">מחק</button>
		</div>`
			)
			.join("") || '<p class="empty-hint">אין היסטוריית משיכות עדיין</p>';
}

function openHistoryModal(id) {
	const c = findCustomer(id);
	if (!c) return;
	openModal(
		`
		<h3>היסטוריית משיכות - ${escapeHtml(c.name)}</h3>
		<div id="history-list"></div>
		<div class="modal-actions">
			<button class="btn" id="f-cancel">סגירה</button>
		</div>`,
		(modal) => {
			renderHistoryRows(modal, c);
			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.addEventListener("click", async (e) => {
				const saveBtn = e.target.closest("[data-hist-save]");
				const delBtn = e.target.closest("[data-hist-del]");
				if (saveBtn) {
					const wid = saveBtn.dataset.histSave;
					const row = saveBtn.closest(".history-row");
					const newDate = row.querySelector(".hist-date").value;
					if (!newDate) return;
					try {
						await api(`/api/customers/${id}/withdrawals/${wid}`, { method: "PATCH", body: { takenAt: newDate } });
						showToast("התאריך עודכן");
						await refresh();
						const updated = findCustomer(id);
						if (updated) renderHistoryRows(modal, updated);
					} catch (err) {
						showToast(err.message, true);
					}
				}
				if (delBtn) {
					if (!confirm("למחוק את המשיכה הזו? מספר השקים שנשארו יתעדכן בהתאם.")) return;
					const wid = delBtn.dataset.histDel;
					try {
						await api(`/api/customers/${id}/withdrawals/${wid}`, { method: "DELETE" });
						showToast("המשיכה נמחקה");
						await refresh();
						const updated = findCustomer(id);
						if (updated) renderHistoryRows(modal, updated);
						else closeModal();
					} catch (err) {
						showToast(err.message, true);
					}
				}
			});
		}
	);
}

function firstName(fullName) {
	return (fullName || "").trim().split(/\s+/)[0] || fullName || "";
}

// A customer with no withdrawal history yet has never actually received a bag from
// us, so this is their first-ever WhatsApp contact and gets the full introduction.
// Everyone else gets one of several equivalent, varied check-in messages so repeat
// outreach doesn't read as a copy-pasted bot message.
// Always plural ("אתם"/"לכם"/"רוצים"), never gendered singular ("אתה"/"את") -
// a message list mixes customers of both genders and we don't track gender,
// so plural phrasing (standard in Hebrew business messaging) avoids guessing wrong.
function newContactMessage(name) {
	return `שלום ${name}, זה מאניפט! 🐾 מה שלומכם? 😊 אנחנו רואים שזה פחות או יותר הזמן שבו אתם לוקחים שק מזון מהמנוי שלכם, תרצו שנשלח לכם הביתה שק נוסף מהמנוי? 📦🚚 המשלוח ללא עלות כמובן! 🎁`;
}

const RETURNING_CONTACT_MESSAGES = [
	(name) => `מה נשמע ${name}? 😊 בא לכם שנוציא לכם שק נוסף במשלוח? 🐾📦`,
	(name) => `היי ${name}! מה קורה? 🙌 רוצים שנשלח לכם שק נוסף הביתה? 🚚🐶`,
	(name) => `${name}, מה המצב? 😄 יש לנו שק מוכן בשבילכם - רוצים שנוציא במשלוח? 📦🐾`,
	(name) => `שלום ${name} 👋 איך הולך? רוצים ששק נוסף יגיע הביתה? 🐾`,
	(name) => `מה נשמע ${name}? 😊 אפשר להוציא לכם שק נוסף במשלוח, רוצים? 🚚`,
];

function returningContactMessage(name) {
	const fn = RETURNING_CONTACT_MESSAGES[Math.floor(Math.random() * RETURNING_CONTACT_MESSAGES.length)];
	return fn(name);
}

const WHATSAPP_TEMPLATES = {
	renew: (name) => `היי ${name}! שמנו לב שנשאר לכם שק אחרון במנוי - רוצים לחדש? 🐾`,
};

function openWhatsappModal(id, template) {
	const c = findCustomer(id);
	if (!c) return;
	const name = firstName(c.name);
	const defaultMessage =
		template === "renew" ? WHATSAPP_TEMPLATES.renew(name) : c.whatsappContactedAt ? returningContactMessage(name) : newContactMessage(name);
	openModal(
		`
		<h3>הודעת וואטסאפ ל${escapeHtml(c.name)}</h3>
		<div class="field">
			<label>טקסט ההודעה (אפשר לערוך לפני השליחה)</label>
			<textarea id="f-msg" rows="5">${escapeHtml(defaultMessage)}</textarea>
		</div>
		<div class="modal-actions">
			<button class="btn btn-whatsapp" id="f-send">פתיחה בוואטסאפ</button>
			<button class="btn" id="f-cancel">ביטול</button>
		</div>`,
		(modal) => {
			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.querySelector("#f-send").addEventListener("click", () => {
				const msg = modal.querySelector("#f-msg").value;
				window.open(toWhatsappLink(c.phone, msg), "_blank", "noopener");
				closeModal();
				if (!c.whatsappContactedAt) {
					api(`/api/customers/${id}`, { method: "PATCH", body: { markWhatsappContacted: true } })
						.then(refresh)
						.catch(() => {});
				}
			});
		}
	);
}

document.getElementById("app").addEventListener("click", async (e) => {
	const btn = e.target.closest("button[data-action]");
	if (!btn) return;
	const { action, id, template } = btn.dataset;
	const customerId = Number(id);

	if (action === "withdraw") return openWithdrawModal(customerId);
	if (action === "wait") return openWaitModal(customerId);
	if (action === "extend-wait") return openWaitModal(customerId, { isExtend: true });
	if (action === "renewal-wait") return openWaitModal(customerId, { mode: "renewal" });
	if (action === "renewal-unwait") {
		try {
			await api(`/api/customers/${customerId}/renewal-unwait`, { method: "POST" });
			showToast("הלקוח חזר לרשימת החידוש הרגילה");
			refresh();
		} catch (err) {
			showToast(err.message, true);
		}
		return;
	}
	if (action === "copy-phone") {
		copyToClipboard(btn.dataset.phone)
			.then(() => showToast("המספר הועתק"))
			.catch(() => showToast("לא ניתן להעתיק את המספר", true));
		return;
	}
	if (action === "toggle-awaiting") {
		const c = findCustomer(customerId);
		if (!c) return;
		try {
			await api(`/api/customers/${customerId}`, { method: "PATCH", body: { awaitingReply: !c.awaitingReply } });
			showToast(c.awaitingReply ? "הסימון בוטל" : "סומן כממתין לתשובה");
			refresh();
		} catch (err) {
			showToast(err.message, true);
		}
		return;
	}
	if (action === "edit") {
		await refresh();
		return openEditModal(customerId);
	}
	if (action === "history") return openHistoryModal(customerId);
	if (action === "whatsapp") return openWhatsappModal(customerId, template);

	if (action === "unwait") {
		try {
			await api(`/api/customers/${customerId}/unwait`, { method: "POST" });
			showToast("הלקוח חזר למעקב הרגיל");
			refresh();
		} catch (err) {
			showToast(err.message, true);
		}
		return;
	}

	if (action === "renew") return openRenewModal(customerId);

	if (action === "delete") return openDeleteModal(customerId);
});

const RENEW_DEFAULT_BAGS = 6;

function openRenewModal(id) {
	const c = findCustomer(id);
	if (!c) return;
	openModal(
		`
		<h3>חידוש מנוי ל${escapeHtml(c.name)}</h3>
		<p class="modal-note">נשארו לו/ה כרגע ${c.bagsRemaining} שקים במנוי.</p>
		<div class="field">
			<label>כמה שקים נוספים להוסיף למנוי?</label>
			<input type="number" id="f-bags-add" value="${RENEW_DEFAULT_BAGS}" min="0" />
		</div>
		<div class="modal-actions">
			<button class="btn btn-primary" id="f-submit">אישור חידוש</button>
			<button class="btn" id="f-cancel">ביטול</button>
		</div>`,
		(modal) => {
			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.querySelector("#f-submit").addEventListener("click", async () => {
				const bagsToAdd = Number(modal.querySelector("#f-bags-add").value);
				try {
					await api(`/api/customers/${id}/renew`, { method: "POST", body: { bagsToAdd } });
					closeModal();
					showToast("המנוי חודש");
					refresh();
				} catch (err) {
					showToast(err.message, true);
				}
			});
		}
	);
}

function openDeleteModal(id) {
	const c = findCustomer(id);
	openModal(
		`
		<h3>הסרת ${c ? escapeHtml(c.name) : "לקוח"} מהמאגר</h3>
		<p class="modal-note">הלקוח יוסר מהמעקב. אם ינסו להוסיף אותו שוב עם אותו מספר טלפון, הצוות יראה אזהרה עם הסיבה שתירשם כאן.</p>
		<div class="field">
			<label>סיבת ההסרה (לא חובה)</label>
			<textarea id="f-reason" rows="2" placeholder="למשל: ביקש/ה לא לקבל הודעות"></textarea>
		</div>
		<div class="modal-actions">
			<button class="btn btn-danger" id="f-submit">הסרה</button>
			<button class="btn" id="f-cancel">ביטול</button>
		</div>`,
		(modal) => {
			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.querySelector("#f-submit").addEventListener("click", async () => {
				const reason = modal.querySelector("#f-reason").value.trim();
				try {
					await api(`/api/customers/${id}`, { method: "DELETE", body: { reason } });
					closeModal();
					showToast("הלקוח הוסר");
					refresh();
				} catch (err) {
					showToast(err.message, true);
				}
			});
		}
	);
}

refresh();
setInterval(refresh, 60000);
