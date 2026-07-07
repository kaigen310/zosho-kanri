// 蔵書管理 PWA版 フロントエンド
// 状態全体を localStorage に保存するスタンドアロン構成（サーバー不要）
// データ形式は Mac版（Flask）の data/books.json と互換

const STORAGE_KEY = "zosho_state_v1";

const STATUS_LABELS = {
  want: "読みたい",
  tsundoku: "積読",
  reading: "読書中",
  done: "読了",
  paused: "中断",
};

const DEFAULT_STATE = {
  books: [],
  profile: {
    interests: "",
    favorite_genres: "",
    favorite_authors: "",
    reading_goal: "",
    note: "",
  },
};

let state = { books: [], profile: {} };
let editingId = null; // null = 新規追加

// ---------- 永続化 ----------
function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.books)) return null;
  const st = { books: raw.books, profile: { ...DEFAULT_STATE.profile } };
  for (const key of Object.keys(DEFAULT_STATE.profile)) {
    if (raw.profile && typeof raw.profile[key] === "string") st.profile[key] = raw.profile[key];
  }
  return st;
}

function loadState() {
  try {
    const st = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    state = st || structuredClone(DEFAULT_STATE);
  } catch {
    state = structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- ユーティリティ ----------
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayStr = () => new Date().toISOString().slice(0, 10);

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------- タブ ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.hidden = panel.id !== `tab-${btn.dataset.tab}`;
    });
  });
});

// ---------- 統計 ----------
function renderStats() {
  const books = state.books;
  const year = new Date().getFullYear();
  const doneThisYear = books.filter(
    (b) => b.status === "done" && (b.finished_at || "").startsWith(String(year))
  ).length;
  const counts = {
    total: books.length,
    reading: books.filter((b) => b.status === "reading").length,
    done: books.filter((b) => b.status === "done").length,
    tsundoku: books.filter((b) => b.status === "tsundoku").length,
  };
  $("#stats").innerHTML = `
    <div class="stat-card"><div class="num">${counts.total}</div><div class="label">蔵書</div></div>
    <div class="stat-card"><div class="num">${counts.reading}</div><div class="label">読書中</div></div>
    <div class="stat-card"><div class="num">${counts.done}</div><div class="label">読了</div></div>
    <div class="stat-card"><div class="num">${doneThisYear}</div><div class="label">今年の読了</div></div>
    <div class="stat-card"><div class="num">${counts.tsundoku}</div><div class="label">積読</div></div>
  `;
}

// ---------- ジャンル一覧の更新 ----------
function updateGenreOptions() {
  const genres = [...new Set(state.books.map((b) => b.genre).filter(Boolean))].sort();
  const filterSel = $("#filter-genre");
  const current = filterSel.value;
  filterSel.innerHTML =
    '<option value="">すべてのジャンル</option>' +
    genres.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  filterSel.value = genres.includes(current) ? current : "";
  $("#genre-list").innerHTML = genres.map((g) => `<option value="${escapeHtml(g)}">`).join("");
}

// ---------- 本の一覧表示 ----------
function renderBooks() {
  const q = $("#search-box").value.trim().toLowerCase();
  const status = $("#filter-status").value;
  const genre = $("#filter-genre").value;
  const sort = $("#sort-order").value;

  let books = state.books.filter((b) => {
    if (status && b.status !== status) return false;
    if (genre && b.genre !== genre) return false;
    if (q) {
      const hay = [b.title, b.author, (b.tags || []).join(" "), b.memo].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const cmp = {
    added_desc: (a, b) => (b.added_at || "").localeCompare(a.added_at || ""),
    added_asc: (a, b) => (a.added_at || "").localeCompare(b.added_at || ""),
    title: (a, b) => (a.title || "").localeCompare(b.title || "", "ja"),
    rating_desc: (a, b) => (b.rating || 0) - (a.rating || 0),
    finished_desc: (a, b) => (b.finished_at || "").localeCompare(a.finished_at || ""),
  }[sort];
  books.sort(cmp);

  $("#book-list").innerHTML = books
    .map((b) => {
      const stars = b.rating ? "★".repeat(b.rating) + "☆".repeat(5 - b.rating) : "";
      const tags = (b.tags || []).map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join(" ");
      return `
      <div class="book-card" data-id="${b.id}">
        <div class="title">${escapeHtml(b.title)}</div>
        <div class="author">${escapeHtml(b.author || "著者未登録")}</div>
        <div class="meta">
          <span class="badge ${b.status}">${STATUS_LABELS[b.status] || b.status}</span>
          ${b.genre ? `<span class="genre-chip">${escapeHtml(b.genre)}</span>` : ""}
          ${stars ? `<span class="stars">${stars}</span>` : ""}
          ${tags}
        </div>
        ${b.memo ? `<div class="memo">${escapeHtml(b.memo)}</div>` : ""}
      </div>`;
    })
    .join("");

  $("#empty-message").hidden = state.books.length > 0;

  document.querySelectorAll(".book-card").forEach((card) => {
    card.addEventListener("click", () => openBookModal(card.dataset.id));
  });
}

function renderAll() {
  renderStats();
  updateGenreOptions();
  renderBooks();
}

// ---------- 本の追加・編集モーダル ----------
function setRating(v) {
  const box = $("#bf-rating");
  box.dataset.value = v;
  box.querySelectorAll("span").forEach((s) => {
    s.classList.toggle("on", Number(s.dataset.v) <= v);
  });
}

$("#bf-rating").addEventListener("click", (e) => {
  const v = Number(e.target.dataset.v);
  if (!v) return;
  // 同じ星をもう一度押すと0に戻す
  setRating(Number($("#bf-rating").dataset.value) === v ? 0 : v);
});

function openBookModal(id) {
  editingId = id || null;
  const b = id ? state.books.find((x) => x.id === id) : null;
  $("#modal-title").textContent = b ? "本を編集" : "本を追加";
  $("#bf-title").value = b ? b.title : "";
  $("#bf-author").value = b ? b.author || "" : "";
  $("#bf-genre").value = b ? b.genre || "" : "";
  $("#bf-status").value = b ? b.status : "want";
  setRating(b ? b.rating || 0 : 0);
  $("#bf-started").value = b ? b.started_at || "" : "";
  $("#bf-finished").value = b ? b.finished_at || "" : "";
  $("#bf-tags").value = b ? (b.tags || []).join(", ") : "";
  $("#bf-memo").value = b ? b.memo || "" : "";
  $("#delete-book-btn").hidden = !b;
  $("#book-modal").hidden = false;
  if (!b) $("#bf-title").focus();
}

function closeBookModal() {
  $("#book-modal").hidden = true;
  editingId = null;
}

$("#add-book-btn").addEventListener("click", () => openBookModal(null));
$("#cancel-btn").addEventListener("click", closeBookModal);
$("#book-modal").addEventListener("click", (e) => {
  if (e.target === $("#book-modal")) closeBookModal();
});

$("#book-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const status = $("#bf-status").value;
  let finished = $("#bf-finished").value;
  // 読了にしたのに読了日が空なら今日を入れる
  if (status === "done" && !finished) finished = todayStr();

  const book = {
    id: editingId || uid(),
    title: $("#bf-title").value.trim(),
    author: $("#bf-author").value.trim(),
    genre: $("#bf-genre").value.trim(),
    status,
    rating: Number($("#bf-rating").dataset.value) || 0,
    started_at: $("#bf-started").value,
    finished_at: finished,
    tags: $("#bf-tags").value.split(/[,、，]/).map((t) => t.trim()).filter(Boolean),
    memo: $("#bf-memo").value.trim(),
    added_at: editingId
      ? state.books.find((x) => x.id === editingId).added_at
      : new Date().toISOString(),
  };

  if (editingId) {
    state.books = state.books.map((x) => (x.id === editingId ? book : x));
  } else {
    state.books.push(book);
  }
  saveState();
  closeBookModal();
  renderAll();
});

$("#delete-book-btn").addEventListener("click", () => {
  const b = state.books.find((x) => x.id === editingId);
  if (!confirm(`『${b.title}』を削除しますか？`)) return;
  state.books = state.books.filter((x) => x.id !== editingId);
  saveState();
  closeBookModal();
  renderAll();
});

// ---------- フィルタ ----------
["#search-box", "#filter-status", "#filter-genre", "#sort-order"].forEach((sel) => {
  $(sel).addEventListener("input", renderBooks);
});

// ---------- プロフィール ----------
function renderProfile() {
  const p = state.profile || {};
  $("#pf-interests").value = p.interests || "";
  $("#pf-genres").value = p.favorite_genres || "";
  $("#pf-authors").value = p.favorite_authors || "";
  $("#pf-goal").value = p.reading_goal || "";
  $("#pf-note").value = p.note || "";
}

$("#save-profile-btn").addEventListener("click", () => {
  state.profile = {
    interests: $("#pf-interests").value.trim(),
    favorite_genres: $("#pf-genres").value.trim(),
    favorite_authors: $("#pf-authors").value.trim(),
    reading_goal: $("#pf-goal").value.trim(),
    note: $("#pf-note").value.trim(),
  };
  saveState();
  const msg = $("#profile-saved");
  msg.hidden = false;
  setTimeout(() => (msg.hidden = true), 2000);
});

// ---------- データのエクスポート / インポート ----------
function stateJson() {
  return JSON.stringify(state, null, 2);
}

$("#download-json-btn").addEventListener("click", () => {
  const blob = new Blob([stateJson()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `books_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#copy-json-btn").addEventListener("click", async (e) => {
  const ok = await copyText(stateJson());
  e.target.textContent = ok ? "✅ コピーしました" : "❌ コピーできませんでした";
  setTimeout(() => (e.target.textContent = "📋 JSONをコピー"), 2000);
});

function showImportMsg(text, isError) {
  const msg = $("#import-msg");
  msg.textContent = text;
  msg.classList.toggle("error", !!isError);
  msg.hidden = false;
  setTimeout(() => (msg.hidden = true), 4000);
}

function importFromText(text) {
  let st;
  try {
    st = normalizeState(JSON.parse(text));
  } catch {
    st = null;
  }
  if (!st) {
    showImportMsg("❌ JSONを読み取れませんでした。形式を確認してください。", true);
    return;
  }
  if (!confirm(`${st.books.length}冊のデータを取り込みます。今のデータ（${state.books.length}冊）はすべて置き換わります。よろしいですか？`)) return;
  state = st;
  saveState();
  renderAll();
  renderProfile();
  $("#import-text").value = "";
  $("#import-file").value = "";
  showImportMsg(`✅ ${st.books.length}冊を取り込みました`);
}

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) importFromText(await file.text());
});

$("#import-btn").addEventListener("click", () => {
  const text = $("#import-text").value.trim();
  if (!text) {
    showImportMsg("ファイルを選ぶか、JSONを貼り付けてください。", true);
    return;
  }
  importFromText(text);
});

// ---------- AI用エクスポート ----------
function buildAiPrompt() {
  const p = state.profile || {};
  const lines = [];
  lines.push("あなたは経験豊富な書店員・司書です。以下の私の読書プロフィールと蔵書リストを踏まえて、次に読むべきおすすめの本を1冊、理由とともに提案してください。すでにリストにある本は避けてください。");
  lines.push("");
  lines.push("【読書プロフィール】");
  if (p.interests) lines.push(`- 趣味・関心: ${p.interests}`);
  if (p.favorite_genres) lines.push(`- 好きなジャンル: ${p.favorite_genres}`);
  if (p.favorite_authors) lines.push(`- 好きな作家: ${p.favorite_authors}`);
  if (p.reading_goal) lines.push(`- 読書の目的: ${p.reading_goal}`);
  if (p.note) lines.push(`- その他: ${p.note}`);
  if (lines[lines.length - 1] === "【読書プロフィール】") lines.push("（未記入）");
  lines.push("");
  lines.push(`【蔵書・読書状況】（全${state.books.length}冊）`);
  for (const b of state.books) {
    let line = `- 『${b.title}』`;
    if (b.author) line += ` ${b.author}`;
    line += `｜${STATUS_LABELS[b.status] || b.status}`;
    if (b.genre) line += `｜${b.genre}`;
    if (b.rating) line += `｜評価${"★".repeat(b.rating)}`;
    if (b.finished_at) line += `｜読了日:${b.finished_at}`;
    if (b.memo) line += `｜感想: ${b.memo}`;
    lines.push(line);
  }
  if (state.books.length === 0) lines.push("（まだ登録なし）");
  lines.push("");
  lines.push("提案の際は「なぜ私に合うのか」を私の読書傾向・評価・感想と結びつけて説明してください。");
  return lines.join("\n");
}

$("#ai-export-btn").addEventListener("click", () => {
  $("#export-text").value = buildAiPrompt();
  $("#export-modal").hidden = false;
});
$("#export-close-btn").addEventListener("click", () => ($("#export-modal").hidden = true));
$("#export-modal").addEventListener("click", (e) => {
  if (e.target === $("#export-modal")) $("#export-modal").hidden = true;
});
$("#copy-export-btn").addEventListener("click", async () => {
  const ok = await copyText($("#export-text").value);
  if (!ok) {
    $("#export-text").select();
    document.execCommand("copy");
  }
  $("#copy-export-btn").textContent = "✅ コピーしました";
  setTimeout(() => ($("#copy-export-btn").textContent = "📋 コピー"), 2000);
});

// ---------- Service Worker（オフライン対応） ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- 初期化 ----------
loadState();
renderAll();
renderProfile();
