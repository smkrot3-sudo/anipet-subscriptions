const API = window.API_BASE_URL;

function todayISO() {
	return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const el = {
	mainBody: document.querySelector("#table-main tbody"),
	waitingBody: document.querySelector("#table-waiting tbody"),
	lastBagBody: document.querySelector("#table-lastbag tbody"),
	toast: document.getElementById("toast"),
	modalBackdrop: document.getElementById("modal-backdrop"),
	modal: document.getElementById("modal"),
	search: document.getElementById("search-box"),
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
		throw new Error(data.error || `שגיאה (${res.status})`);
	}
	return data;
}

function toWhatsappLink(phone, message) {
	let digits = (phone || "").replace(/[^\d]/g, "");
	if (digits.startsWith("0")) digits = "972" + digits.slice(1);
	const text = encodeURIComponent(message || "");
	return `https://wa.me/${digits}${text ? `?text=${text}` : ""}`;
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

let allGroups = { main: [], waitingList: [], lastBag: [] };

async function refresh() {
	try {
		allGroups = await api("/api/customers");
		applyFilter();
	} catch (err) {
		showToast(err.message, true);
	}
}

function applyFilter() {
	const q = (el.search.value || "").trim().toLowerCase();
	const match = (c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q);
	renderMain(allGroups.main.filter(match));
	renderWaiting(allGroups.waitingList.filter(match));
	renderLastBag(allGroups.lastBag.filter(match));
}

el.search.addEventListener("input", applyFilter);

function notesLine(c) {
	return c.notes ? `<div class="notes-line">${escapeHtml(c.notes)}</div>` : "";
}

function renderMain(rows) {
	document.querySelector("#table-main").parentElement.nextElementSibling.classList.toggle("hidden", rows.length > 0);
	el.mainBody.innerHTML = rows
		.map(
			(c) => `
		<tr class="${colorLabel(c.color)}">
			<td class="name-cell">${escapeHtml(c.name)}${notesLine(c)}</td>
			<td><a class="phone-link" href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></td>
			<td>${c.bagsRemaining}</td>
			<td>${fmtDate(c.lastWithdrawal)}</td>
			<td>${fmtDate(c.nextEstimate)}</td>
			<td class="actions-cell">
				<button class="btn btn-whatsapp" data-action="whatsapp" data-template="reminder" data-id="${c.id}">וואטסאפ</button>
				<button class="btn" data-action="withdraw" data-id="${c.id}">סימון משיכה</button>
				<button class="btn" data-action="wait" data-id="${c.id}">עדיין לא צריך</button>
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
			<td class="name-cell">${escapeHtml(c.name)}${notesLine(c)}</td>
			<td><a class="phone-link" href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></td>
			<td>${fmtDate(c.waitingUntil)}</td>
			<td class="actions-cell">
				<button class="btn" data-action="withdraw" data-id="${c.id}">משך שק</button>
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
			<td class="name-cell">${escapeHtml(c.name)}${notesLine(c)}</td>
			<td><a class="phone-link" href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></td>
			<td>${c.bagsRemaining}</td>
			<td class="actions-cell">
				<button class="btn btn-whatsapp" data-action="whatsapp" data-template="renew" data-id="${c.id}">וואטסאפ</button>
				<button class="btn btn-primary" data-action="renew" data-id="${c.id}">חודש</button>
			</td>
		</tr>`
		)
		.join("");
}

function findCustomer(id) {
	return allGroups.main.find((r) => r.id === id) || allGroups.waitingList.find((r) => r.id === id) || allGroups.lastBag.find((r) => r.id === id);
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
			<label>תאריכי משיכות קודמות (לא חובה - עוזר לחשב תדירות)</label>
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
				try {
					await api("/api/customers", { method: "POST", body: { name, phone, bagsRemaining, notes, history } });
					closeModal();
					showToast("הלקוח נוסף בהצלחה");
					refresh();
				} catch (err) {
					errBox.textContent = err.message;
				}
			});
		}
	);
});

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

function openWaitModal(id) {
	openModal(
		`
		<h3>הלקוח עדיין לא צריך שק</h3>
		<div class="field">
			<label>לחזור אליו בעוד כמה ימים?</label>
			<input type="number" id="f-days" value="7" min="0" />
		</div>
		<div class="modal-actions">
			<button class="btn btn-primary" id="f-submit">שמירה</button>
			<button class="btn" id="f-cancel">ביטול</button>
		</div>`,
		(modal) => {
			modal.querySelector("#f-cancel").addEventListener("click", closeModal);
			modal.querySelector("#f-submit").addEventListener("click", async () => {
				const days = Number(modal.querySelector("#f-days").value) || 0;
				try {
					await api(`/api/customers/${id}/wait`, { method: "POST", body: { days } });
					closeModal();
					showToast("הלקוח הועבר לרשימת ההמתנה");
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

const WHATSAPP_TEMPLATES = {
	reminder: (name) => `היי ${name}! רצינו לבדוק אם תרצו שנוציא לכם שק מזון במשלוח 🐾`,
	renew: (name) => `היי ${name}! שמנו לב שנשאר לכם שק אחרון במנוי - רוצים לחדש?`,
};

function openWhatsappModal(id, template) {
	const c = findCustomer(id);
	if (!c) return;
	const defaultMessage = (WHATSAPP_TEMPLATES[template] || WHATSAPP_TEMPLATES.reminder)(c.name);
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

	if (action === "renew") {
		try {
			await api(`/api/customers/${customerId}/renew`, { method: "POST" });
			showToast("המנוי חודש");
			refresh();
		} catch (err) {
			showToast(err.message, true);
		}
		return;
	}

	if (action === "delete") {
		if (!confirm("למחוק את הלקוח לצמיתות? הפעולה אינה הפיכה.")) return;
		try {
			await api(`/api/customers/${customerId}`, { method: "DELETE" });
			showToast("הלקוח נמחק");
			refresh();
		} catch (err) {
			showToast(err.message, true);
		}
	}
});

refresh();
setInterval(refresh, 60000);
