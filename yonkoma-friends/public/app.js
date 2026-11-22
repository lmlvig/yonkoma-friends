"use strict";
const $root = document.getElementById("root");
let myToken = localStorage.getItem("yk_token");
if (!myToken) { myToken = "u" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("yk_token", myToken); }
const ADMINPW = () => localStorage.getItem("yk_admin") || "";

let ME = null;
let VIEW = "feed"; // feed | search | create | mypage
let SORT = "new";
let gateError = "";

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "content-type": "application/json", "x-user-token": myToken }, ...opts });
  if (r.status === 401) { const j = await r.json().catch(() => ({})); if (j.error === "gate") { renderGate(); throw new Error("gate"); } }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "error");
  return j;
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
function avatarHtml(a, size) {
  const st = size ? ` style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px"` : "";
  if (a.authorAvatarImage || a.avatarImage) return `<div class="avatar"${st}><img src="${esc(a.authorAvatarImage || a.avatarImage)}" alt=""></div>`;
  return `<div class="avatar"${st}>${esc(a.authorAvatar || a.avatar || "🐱")}</div>`;
}
function fmtDate(ts) { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

/* ---------- panel rendering ---------- */
function burstPath() { // starburst polygon for burst bubble background (drawn as SVG)
  const pts = []; const n = 14;
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? 38 : 50; const a = (Math.PI * i) / n; pts.push(`${50 + r * Math.cos(a)},${50 + r * Math.sin(a)}`); }
  return pts.join(" ");
}
function elHtml(el) {
  const style = `left:${el.x}%;top:${el.y}%;width:${el.w}%;height:${el.h}%;font-size:${((el.font || 15) / 4).toFixed(2)}cqw;color:${el.color || "#1a1a2e"};z-index:${el.z || 1}`;
  if (el.type === "mascot") return `<div class="el" style="${style}"><img src="mascot.png" style="width:100%;height:100%;object-fit:contain" alt=""></div>`;
  if (el.type === "shape") {
    const bg = el.fill || "#ffd166";
    if (el.shape === "circle") return `<div class="el" style="${style};background:${bg};border-radius:50%"></div>`;
    if (el.shape === "star") return `<div class="el" style="${style};font-size:${((el.h || 20) * 0.6).toFixed(1)}cqw;color:${bg}"><span>★</span></div>`;
    if (el.shape === "heart") return `<div class="el" style="${style};font-size:${((el.h || 20) * 0.6).toFixed(1)}cqw;color:${bg}"><span>♥</span></div>`;
    return `<div class="el" style="${style};background:${bg};border-radius:6px"></div>`;
  }
  if (el.type === "bubble") {
    if (el.shape === "burst") return `<div class="el burst" style="${style}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%"><polygon points="${burstPath()}" fill="${el.fill || "#fff"}" stroke="#1a1a2e" stroke-width="2.5"/></svg><span style="position:relative;z-index:2">${esc(el.text || "")}</span></div>`;
    return `<div class="el bubble ${el.shape || "round"}" style="${style};background:${el.fill || "#ffffff"}"><span>${esc(el.text || "")}</span></div>`;
  }
  return `<div class="el txt" style="${style};font-weight:800"><span>${esc(el.text || "")}</span></div>`;
}
function panelInner(panel, zoomable) {
  if (!panel) return "";
  if (panel.image) return `<img class="panel-img" ${zoomable ? `data-zoom="${panel.image}" ` : ""}src="${panel.image}" alt="">`;
  return `<div style="position:absolute;inset:0;background:${panel.bg || "#ffffff"}">${(panel.elements || []).map(elHtml).join("")}</div>`;
}
function panelBox(panel, num, zoomable) {
  return `<div class="panel-box">${panelInner(panel, zoomable)}</div>`;
}
function postPanels(post) { // normalize to array of panel objects
  if (post.mode === "image") {
    if (post.images.length === 1) return null; // whole image
    return post.images.map(src => ({ image: src }));
  }
  return post.panels;
}
function postBodyHtml(post, full) {
  const panels = postPanels(post);
  if (panels === null) return full ? `<img class="whole-img full" data-zoom="${post.images[0]}" src="${post.images[0]}" alt="">` : `<img class="whole-img" src="${post.images[0]}" alt=""><div class="muted" style="margin-top:6px">▽ タップで拡大表示</div>`;
  if (!full) {
    const show = post.parentId ? panels.slice(0, 1) : panels.slice(0, 2);
    return `<div class="panels-stack">${show.map((p, i) => panelBox(p, i + 1)).join("")}</div>`
      + (panels.length > show.length ? `<div class="muted" style="margin-top:6px">▽ タップで続きを見る（${show.length + 1}・${panels.length}コマ目）</div>` : "");
  }
  return `<div style="display:flex;flex-direction:column;gap:8px">${panels.map((p, i) => panelBox(p, i + 1, true)).join("")}</div>`;
}
function postCardHtml(post, full) {
  return `<div class="card" data-post="${post.id}">
    <div class="row">
      <span data-act="author" data-post="${post.id}" style="cursor:pointer">${avatarHtml(post)}</span>
      <div class="grow"><span class="author-name" data-act="author" data-post="${post.id}" style="cursor:pointer">${esc(post.authorName)}</span>
      ${post.authorFollowed && !post.mine ? ` <span class="badge">フォロー中</span>` : ""}
      <div class="muted">${fmtDate(post.created)}${post.parent ? ` ・ 「${esc(post.parent.title || "（タイトルなし）")}」（${esc(post.parent.authorName)}）の続き` : ""}</div></div>
      ${!post.mine ? `<button class="ghost-btn" data-act="follow" data-post="${post.id}">${post.authorFollowed ? "フォロー中" : "フォロー"}</button>` : ""}
    </div>
    ${post.title ? `<h3>${esc(post.title)}</h3>` : ""}
    <div data-act="open" data-post="${post.id}" style="cursor:pointer">${postBodyHtml(post, full)}</div>
    <div class="row" style="margin-top:10px">
      <button class="like-btn ${post.liked ? "liked" : ""}" data-act="like" data-post="${post.id}">👍 ${post.likeCount}</button>
      <button class="ghost-btn" data-act="continue" data-post="${post.id}">✏️ 勝手に続きを書く</button>
      ${post.continuationCount ? `<button class="ghost-btn" data-act="chain" data-post="${post.id}">📚 書かれた続きを見る（${post.continuationCount}）</button>` : ""}
      ${post.mine ? `<button class="ghost-btn" data-act="del" data-post="${post.id}">削除</button>` : ""}
      ${ADMINPW() ? `<button class="ghost-btn" data-act="admin-del" data-post="${post.id}" style="color:#d6336c;border-color:#d6336c">🗑 管理者削除</button>` : ""}
    </div>
  </div>`;
}

/* ---------- gate & profile ---------- */
function renderGate() {
  $root.innerHTML = `<div class="gate-wrap"><div class="gate-card">
    <img src="mascot.png" alt=""><h2>4コマ漫画広場</h2>
    <p class="muted">友達限定テスト版です。合言葉を入れてください。</p>
    <input type="password" id="gatePw" placeholder="合言葉">
    <div class="err">${esc(gateError)}</div>
    <button class="primary-btn" id="gateBtn" style="width:100%">入る</button>
  </div></div>`;
  const go = async () => {
    const pw = document.getElementById("gatePw").value;
    const r = await fetch("/api/gate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) { gateError = ""; boot(); } else { gateError = "合言葉が違います"; renderGate(); }
  };
  document.getElementById("gateBtn").onclick = go;
  document.getElementById("gatePw").onkeydown = e => { if (e.key === "Enter") go(); };
}
function renderProfileSetup() {
  $root.innerHTML = `<div class="gate-wrap"><div class="gate-card">
    <img src="mascot.png" alt=""><h2>はじめまして！</h2>
    <p class="muted">表示名を決めてください（あとで変更できます）。</p>
    <input type="text" id="myName" placeholder="名前" maxlength="30">
    <div style="height:10px"></div>
    <button class="primary-btn" id="profBtn" style="width:100%">はじめる</button>
  </div></div>`;
  document.getElementById("profBtn").onclick = async () => {
    const name = document.getElementById("myName").value.trim() || "ななし作家";
    await api("/api/me", { method: "POST", body: JSON.stringify({ token: myToken, name, avatar: "🐱", avatarImage: "" }) });
    const m = await api("/api/me"); ME = m.user; renderShell();
  };
}
async function boot() {
  try {
    const m = await api("/api/me");
    ME = m.user;
    if (!ME) return renderProfileSetup();
    renderShell();
  } catch (e) { if (String(e.message) !== "gate") renderGate(); }
}

/* ---------- shell & views ---------- */
function renderShell() {
  $root.innerHTML = `<div id="app">
    <header class="top"><img class="mascot" src="mascot.png" alt=""><div><div class="title">4コマ漫画広場</div><div class="sub">友達限定テスト版</div></div></header>
    <main id="main"></main>
    <nav class="bottom">
      <button data-nav="feed" class="${VIEW === "feed" ? "on" : ""}"><span class="ic">🏠</span>タイムライン</button>
      <button data-nav="search" class="${VIEW === "search" ? "on" : ""}"><span class="ic">🔍</span>さがす</button>
      <button data-nav="create" class="${VIEW === "create" ? "on" : ""}"><span class="ic">✏️</span>つくる</button>
      <button data-nav="mypage" class="${VIEW === "mypage" ? "on" : ""}"><span class="ic">👤</span>マイページ</button>
    </nav></div>`;
  document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => { VIEW = b.dataset.nav; renderShell(); });
  if (VIEW === "feed") renderFeed();
  else if (VIEW === "search") renderSearch();
  else if (VIEW === "create") renderCreate(null);
  else if (VIEW === "mypage") renderMypage();
}
async function renderFeed() {
  const main = document.getElementById("main");
  main.innerHTML = `<div class="row" style="margin-bottom:12px">
      <button class="chip ${SORT === "new" ? "on" : ""}" id="sortNew">新着順</button>
      <button class="chip ${SORT === "popular" ? "on" : ""}" id="sortPop">人気順</button>
      <button class="chip" id="toRank">🏆 ランキング</button></div><div id="feedList"><p class="muted">読み込み中…</p></div>`;
  document.getElementById("sortNew").onclick = () => { SORT = "new"; renderFeed(); };
  document.getElementById("sortPop").onclick = () => { SORT = "popular"; renderFeed(); };
  document.getElementById("toRank").onclick = renderRanking;
  const { posts } = await api("/api/feed?sort=" + SORT);
  const list = document.getElementById("feedList");
  if (!list) return;
  list.innerHTML = posts.length ? posts.map(p => postCardHtml(p, false)).join("") : `<div class="card"><p>まだ投稿がありません。「つくる」から最初の4コマを投稿してみよう！</p></div>`;
  bindPostActions(list, posts);
}
async function renderRanking() {
  const main = document.getElementById("main");
  main.innerHTML = `<div class="row" style="margin-bottom:12px"><button class="ghost-btn" id="backFeed">← タイムライン</button><h3 style="margin:0">🏆 ユーザーランキング</h3></div><p class="muted">投稿した全作品についた👍の合計が多い順です。</p><div id="rankList"><p class="muted">読み込み中…</p></div>`;
  document.getElementById("backFeed").onclick = renderFeed;
  const { authors } = await api("/api/ranking");
  const list = document.getElementById("rankList");
  list.innerHTML = authors.length ? authors.map((a, i) => `<div class="card"><div class="row"><div class="rank-num">${i + 1}</div><span data-author-link="${esc(a.token)}" style="cursor:pointer">${avatarHtml({ authorAvatar: a.avatar, authorAvatarImage: a.avatarImage })}</span><div class="grow"><span class="author-name" data-author-link="${esc(a.token)}" style="cursor:pointer">${esc(a.name)}</span><div class="muted">👍 合計 ${a.totalLikes} ・ 作品 ${a.postCount} 本</div></div></div></div>`).join("") : `<div class="card"><p>まだ作品がありません。</p></div>`;
  list.querySelectorAll("[data-author-link]").forEach(b => b.onclick = () => openAuthor(b.dataset.authorLink));
}
async function renderSearch(prefill) {
  const main = document.getElementById("main");
  main.innerHTML = `<div class="search-row"><input type="text" id="q" placeholder="作家名・タイトルで検索" value="${esc(prefill || "")}"><button class="primary-btn" id="qBtn">検索</button></div><div id="authorList"><p class="muted">読み込み中…</p></div>`;
  const load = async () => {
    const q = document.getElementById("q").value.trim();
    const { authors } = await api("/api/authors?q=" + encodeURIComponent(q));
    const list = document.getElementById("authorList");
    if (!list) return;
    const roll = authors.filter(a => a.onARoll);
    let html = "";
    if (roll.length) html += `<div class="section-band"><h3>🔥 今、筆が乗っている作家</h3><div style="font-size:12px;font-weight:700">直近7日でたくさん投稿している作家です</div></div>`
      + roll.map(a => authorCardHtml(a)).join("");
    html += authors.filter(a => !a.onARoll).map(a => authorCardHtml(a)).join("");
    list.innerHTML = html || `<div class="card"><p>見つかりませんでした。</p></div>`;
    list.querySelectorAll("[data-follow]").forEach(b => b.onclick = async () => { await api("/api/follow/" + encodeURIComponent(b.dataset.follow), { method: "POST", body: "{}" }); load(); });
    list.querySelectorAll("[data-top]").forEach(b => b.onclick = () => { VIEW = "feed"; renderShell(); setTimeout(() => openPost(Number(b.dataset.top)), 350); });
    list.querySelectorAll("[data-author-link]").forEach(b => b.onclick = () => openAuthor(b.dataset.authorLink));
  };
  document.getElementById("qBtn").onclick = load;
  document.getElementById("q").onkeydown = e => { if (e.key === "Enter") load(); };
  load();
}
function authorCardHtml(a) {
  return `<div class="card"><div class="row"><span data-author-link="${esc(a.token)}" style="cursor:pointer">${avatarHtml({ authorAvatar: a.avatar, authorAvatarImage: a.avatarImage })}</span>
    <div class="grow"><span class="author-name" data-author-link="${esc(a.token)}" style="cursor:pointer">${esc(a.name)}</span> ${a.onARoll ? `<span class="badge">🔥 筆が乗ってる！</span>` : ""}
    <div class="muted">投稿 ${a.postCount} 本 ・ フォロー ${a.following ?? 0} ・ フォロワー ${a.followers ?? 0}${a.onARoll ? ` ・ 直近7日で${a.recentPosts}本投稿` : ""}</div></div>
    ${a.token !== myToken ? `<button class="ghost-btn" data-follow="${esc(a.token)}">${a.followed ? "フォロー中" : "フォロー"}</button>` : ""}</div>
    <div style="margin-top:8px"><button class="linkish" data-top="${a.topPost.id}">代表作：「${esc(a.topPost.title || "（タイトルなし）")}」を見る →</button></div></div>`;
}
async function renderMypage() {
  const main = document.getElementById("main");
  const avatars = ["🐱", "🐶", "🦊", "🐰", "🐻", "🐼", "🦁", "🐸", "🎨", "⭐"];
  main.innerHTML = `<div class="card"><h3>プロフィール</h3>
    <div class="row">${avatarHtml({ authorAvatar: ME.avatar, authorAvatarImage: ME.avatarImage })}<div class="grow"><input type="text" id="mpName" value="${esc(ME.name)}" maxlength="30"></div></div>
    <div class="muted" style="margin-top:6px">フォロー中 ${ME.following ?? 0} ・ フォロワー ${ME.followers ?? 0}</div>
    <div class="palette" id="mpAvatars">${avatars.map(a => `<button data-av="${a}" style="background:var(--surface2);font-size:18px" class="${ME.avatar === a && !ME.avatarImage ? "on" : ""}">${a}</button>`).join("")}</div>
    <div class="row"><label class="ghost-btn" style="display:inline-block">🖼 アルバムからアイコン画像<input type="file" id="mpImg" accept="image/*" class="hidden"></label>
    ${ME.avatarImage ? `<button class="ghost-btn" id="mpImgClear">画像をやめる</button>` : ""}</div>
    <div style="height:8px"></div><button class="primary-btn" id="mpSave">保存する</button></div>
    <div class="card"><h3>管理者</h3><div id="adminArea"></div></div>
    <h3 style="margin:14px 2px 8px">自分の作品</h3><div id="myPosts"><p class="muted">読み込み中…</p></div>`;
  let selAvatar = ME.avatar, selImage = ME.avatarImage || "";
  main.querySelectorAll("[data-av]").forEach(b => b.onclick = () => { selAvatar = b.dataset.av; selImage = ""; main.querySelectorAll("[data-av]").forEach(x => x.classList.remove("on")); b.classList.add("on"); });
  document.getElementById("mpImg").onchange = async e => { const f = e.target.files[0]; if (!f) return; selImage = await fileToSquare(f); toast("画像をセットしました（保存で反映）"); };
  const clearBtn = document.getElementById("mpImgClear"); if (clearBtn) clearBtn.onclick = () => { selImage = ""; toast("絵文字アイコンに戻します（保存で反映）"); };
  document.getElementById("mpSave").onclick = async () => {
    const name = document.getElementById("mpName").value.trim() || "ななし作家";
    await api("/api/me", { method: "POST", body: JSON.stringify({ token: myToken, name, avatar: selAvatar, avatarImage: selImage }) });
    const m = await api("/api/me"); ME = m.user; toast("保存しました"); renderMypage();
  };
  const drawAdmin = () => {
    const area = document.getElementById("adminArea"); if (!area) return;
    if (ADMINPW()) {
      area.innerHTML = `<p class="muted">管理者モード有効中です。各作品に「🗑 管理者削除」ボタンが表示されます。</p><button class="ghost-btn" id="admOff">管理者モードを解除する</button>`;
      document.getElementById("admOff").onclick = () => { localStorage.removeItem("yk_admin"); toast("解除しました"); renderMypage(); };
    } else {
      area.innerHTML = `<p class="muted">管理者パスワードを入れると、他人の作品も削除できるようになります。</p><div class="row"><input type="password" id="admPw" placeholder="管理者パスワード" style="flex:1"><button class="primary-btn" id="admOn">有効にする</button></div>`;
      document.getElementById("admOn").onclick = async () => {
        const pw = document.getElementById("admPw").value;
        const r = await fetch("/api/admin/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
        if (r.ok) { localStorage.setItem("yk_admin", pw); toast("管理者モードを有効にしました"); renderMypage(); }
        else toast("パスワードが違うか、サーバー未設定です");
      };
    }
  };
  drawAdmin();
  const { posts } = await api("/api/feed?sort=new");
  const mine = posts.filter(p => p.mine);
  const list = document.getElementById("myPosts");
  list.innerHTML = mine.length ? mine.map(p => postCardHtml(p, false)).join("") : `<div class="card"><p>まだ作品がありません。</p></div>`;
  bindPostActions(list, mine);
}

/* ---------- post actions / overlay ---------- */
function bindPostActions(container, posts) {
  const byId = {}; posts.forEach(p => byId[p.id] = p);
  container.querySelectorAll("[data-act]").forEach(el => {
    el.onclick = async ev => {
      ev.stopPropagation();
      const id = Number(el.dataset.post); const post = byId[id]; if (!post) return;
      const act = el.dataset.act;
      if (act === "like") {
        const r = await api(`/api/posts/${id}/like`, { method: "POST", body: "{}" });
        post.likeCount = r.likeCount; post.liked = r.liked;
        el.className = "like-btn" + (r.liked ? " liked" : ""); el.textContent = `👍 ${r.likeCount}`;
      } else if (act === "open") openPost(id);
      else if (act === "chain") openChain(id);
      else if (act === "continue") { VIEW = "create"; renderShell(); setTimeout(() => renderCreate(post), 50); }
      else if (act === "author") openAuthor(post.authorToken);
      else if (act === "follow") {
        const r = await api("/api/follow/" + encodeURIComponent(post.authorToken), { method: "POST", body: "{}" });
        toast(r.followed ? "フォローしました" : "フォローを外しました"); renderShell();
      } else if (act === "admin-del") {
        const extra = post.continuationCount ? "（続きも一緒に削除されます）" : "";
        if (confirm("管理者権限でこの作品を削除しますか？" + extra)) {
          await api("/api/admin/posts/" + id, { method: "DELETE", headers: { "content-type": "application/json", "x-user-token": myToken, "x-admin-password": ADMINPW() } });
          toast("削除しました"); renderShell();
        }
      } else if (act === "del") {
        if (confirm("この作品を削除しますか？")) { await api(`/api/posts/${id}`, { method: "DELETE" }); toast("削除しました"); renderShell(); }
      }
    };
  });
}
function showOverlay(html) {
  closeOverlay();
  document.body.style.overflow = "hidden";
  const ov = document.createElement("div"); ov.className = "overlay"; ov.id = "ov";
  ov.innerHTML = `<div class="sheet">${html}</div>`;
  ov.onclick = e => { if (e.target === ov) closeOverlay(); };
  document.body.appendChild(ov);
  return ov;
}
function closeOverlay() { const ov = document.getElementById("ov"); if (ov) ov.remove(); document.body.style.overflow = ""; }
async function openPost(id) {
  const { chain } = await api("/api/chain/" + id);
  const target = chain.find(p => p.id === id) || chain[chain.length - 1];
  const idx = chain.indexOf(target);
  const ov = showOverlay(`<div class="row" style="margin-bottom:10px"><button class="ghost-btn" id="ovClose">← 閉じる</button><h3 style="margin:0">${esc(target.title || "（タイトルなし）")}</h3></div>
    <div id="ovBody"></div>
    ${idx < chain.length - 1 ? `<div class="chain-arrow">⬇ この作品の続きがあります</div><button class="primary-btn" id="ovChain" style="width:100%">📚 続きを最初から読む</button>` : ""}`);
  document.getElementById("ovClose").onclick = closeOverlay;
  const body = document.getElementById("ovBody");
  body.innerHTML = postCardHtml(target, true);
  bindPostActions(body, [target]);
  const cb = document.getElementById("ovChain"); if (cb) cb.onclick = () => openChain(chain[0].id);
}
async function openChain(rootId) {
  const { chain } = await api("/api/chain/" + rootId);
  const ov = showOverlay(`<div class="row" style="margin-bottom:10px"><button class="ghost-btn" id="ovClose">← 閉じる</button><h3 style="margin:0">📚 続きのチェーン</h3></div>
    <div id="ovBody">${chain.map((p, i) => `${i ? `<div class="chain-arrow">⬇ ${esc(p.authorName)} の続き</div>` : ""}<div class="chain-item">${postCardHtml(p, true)}</div>`).join("")}</div>`);
  document.getElementById("ovClose").onclick = closeOverlay;
  bindPostActions(document.getElementById("ovBody"), chain);
}

async function openAuthor(token) {
  const { user, posts } = await api("/api/author/" + encodeURIComponent(token));
  showOverlay(`
    <div class="row" style="justify-content:space-between"><strong>プロフィール</strong><button class="ghost-btn" id="ovClose">✕ 閉じる</button></div>
    <div class="card" style="text-align:center">
      <div style="display:flex;justify-content:center">${avatarHtml({ authorAvatar: user.avatar, authorAvatarImage: user.avatarImage }, 72)}</div>
      <h3 style="margin:8px 0 2px">${esc(user.name)}</h3>
      <div class="muted">フォロー中 ${user.following} ・ フォロワー ${user.followers} ・ 投稿 ${posts.length} 本</div>
      ${user.mine ? "" : `<button class="primary-btn" id="ovFollow" style="margin-top:10px">${user.followed ? "フォロー中（タップで解除）" : "フォローする"}</button>`}
    </div>
    <h3>作品</h3>
    <div id="ovBody">${posts.length ? posts.map(p => postCardHtml(p, false)).join("") : `<p class="muted">まだ作品がありません。</p>`}</div>`);
  document.getElementById("ovClose").onclick = closeOverlay;
  const fb = document.getElementById("ovFollow");
  if (fb) fb.onclick = async () => { await api("/api/follow/" + encodeURIComponent(token), { method: "POST", body: "{}" }); openAuthor(token); };
  bindPostActions(document.getElementById("ovBody"), posts);
}

/* ---------- images ---------- */
function fileToDataUrl(file, max = 1000) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); res(c.toDataURL("image/jpeg", 0.85)); };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
function fileToSquare(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const side = Math.min(img.width, img.height); const c = document.createElement("canvas"); c.width = 200; c.height = 200; c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 200, 200); URL.revokeObjectURL(img.src); res(c.toDataURL("image/jpeg", 0.85)); };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}

/* ---------- editor ---------- */
const PALETTE = ["#ffffff", "#fff3b0", "#ffd166", "#ffb3c1", "#cdb4db", "#a2d2ff", "#bde0fe", "#caffbf", "#1a1a2e", "#e63946"];
let ED = null; // {panels:[{bg,elements:[]}], cur:0, sel:idx|null, single:bool}
function newPanel() { return { bg: "#ffffff", elements: [] }; }
function initEditor(single) {
  ED = { panels: single ? [newPanel()] : [newPanel(), newPanel(), newPanel(), newPanel()], cur: 0, sel: null };
}
function renderEditorInto(container) {
  const p = ED.panels[ED.cur];
  container.innerHTML = `
    ${ED.panels.length > 1 ? `<div class="panel-tabs">${ED.panels.map((_, i) => `<button data-pt="${i}" class="${i === ED.cur ? "on" : ""}">${i + 1}コマ目</button>`).join("")}</div>` : `<div class="muted" style="margin-bottom:6px">続きは1コマだけです</div>`}
    <div class="ed-canvas" id="edCanvas">${panelInner(p)}</div>
    <div class="tool-row">
      <button data-tool="bubble-round">💬 丸吹き出し</button>
      <button data-tool="bubble-square">🗨 四角吹き出し</button>
      <button data-tool="bubble-thought">💭 考え吹き出し</button>
      <button data-tool="bubble-burst">💥 爆発吹き出し</button>
      <button data-tool="text">🔤 テキスト</button>
      <button data-tool="shape-rect">⬛ 四角</button>
      <button data-tool="shape-circle">⚪ 丸</button>
      <button data-tool="shape-star">⭐ 星</button>
      <button data-tool="shape-heart">❤️ ハート</button>
      <button data-tool="mascot">🐰 マスコット</button>
    </div>
    <p class="muted">人物や物は、テキストにキーボードの絵文字を入れて表現してね（例：🏃‍♂️‍➡️🧍‍♂️🧍‍♀️🧎‍♂️‍➡️🚶‍♀️‍➡️🚗🦔🎾🏀🍎🍐）。要素はドラッグで移動、右下の●で大きさ変更。</p>
    <div id="edProps"></div>
    <div class="row"><span class="muted">コマの背景色</span><div class="palette" id="bgPal">${PALETTE.map(c => `<button data-bg="${c}" style="background:${c}" class="${p.bg === c ? "on" : ""}"></button>`).join("")}</div></div>`;
  container.querySelectorAll("[data-pt]").forEach(b => b.onclick = () => { ED.cur = Number(b.dataset.pt); ED.sel = null; renderEditorInto(container); });
  container.querySelectorAll("[data-bg]").forEach(b => b.onclick = () => { ED.panels[ED.cur].bg = b.dataset.bg; renderEditorInto(container); });
  container.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => addElement(b.dataset.tool, container));
  const canvas = document.getElementById("edCanvas");
  // re-wrap elements as editable nodes
  const panel = ED.panels[ED.cur];
  canvas.innerHTML = `<div style="position:absolute;inset:0;background:${panel.bg}">${panel.elements.map((el, i) => {
    const html = elHtml(el);
    return html.replace('class="el', `data-ei="${i}" class="el${ED.sel === i ? " sel" : ""}`);
  }).join("")}</div>`;
  canvas.querySelectorAll("[data-ei]").forEach(node => {
    const i = Number(node.dataset.ei);
    const handle = document.createElement("div"); handle.className = "handle"; handle.style.display = ED.sel === i ? "block" : "none";
    if (ED.sel === i) node.appendChild(handle);
    node.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      const isHandle = ev.target === handle;
      ED.sel = i; renderEditorInto(container);
      const c2 = document.getElementById("edCanvas"); const node2 = c2.querySelector(`[data-ei="${i}"]`);
      const rect = c2.getBoundingClientRect(); const el = ED.panels[ED.cur].elements[i];
      const sx = ev.clientX, sy = ev.clientY, ox = el.x, oy = el.y, ow = el.w, oh = el.h;
      const move = e2 => {
        const dx = (e2.clientX - sx) / rect.width * 100, dy = (e2.clientY - sy) / rect.height * 100;
        if (isHandle) { el.w = Math.max(8, Math.min(95, ow + dx)); el.h = Math.max(8, Math.min(95, oh + dy)); if (el.type === "text") { el.font = Math.max(9, Math.min(204, Math.round(el.h * 3))); node2.style.fontSize = (el.font / 4).toFixed(2) + "cqw"; } }
        else { el.x = Math.max(0, Math.min(97, ox + dx)); el.y = Math.max(0, Math.min(97, oy + dy)); }
        node2.style.left = el.x + "%"; node2.style.top = el.y + "%"; node2.style.width = el.w + "%"; node2.style.height = el.h + "%";
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); renderProps(container); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    });
  });
  canvas.addEventListener("pointerdown", ev => { if (ev.target === canvas || ev.target.parentElement === canvas && ev.target.tagName === "DIV" && !ev.target.dataset.ei) { ED.sel = null; renderEditorInto(container); } });
  renderProps(container);
}
function addElement(tool, container) {
  const panel = ED.panels[ED.cur];
  const z = panel.elements.length + 1;
  let el;
  if (tool.startsWith("bubble-")) el = { type: "bubble", shape: tool.slice(7), text: "セリフ", x: 25, y: 35, w: 50, h: 26, fill: "#ffffff", color: "#1a1a2e", font: 15, z };
  else if (tool === "text") el = { type: "text", text: "テキスト", x: 30, y: 45, w: 40, h: 12, color: "#1a1a2e", font: 18, z };
  else if (tool.startsWith("shape-")) el = { type: "shape", shape: tool.slice(6), x: 35, y: 35, w: 28, h: 28, fill: "#ffd166", z };
  else if (tool === "mascot") el = { type: "mascot", x: 32, y: 22, w: 36, h: 48, z };
  panel.elements.push(el); ED.sel = panel.elements.length - 1;
  renderEditorInto(container);
}
function renderProps(container) {
  const box = container.querySelector("#edProps"); if (!box) return;
  const panel = ED.panels[ED.cur]; const el = ED.sel != null ? panel.elements[ED.sel] : null;
  if (!el) { box.innerHTML = `<p class="muted">要素を選ぶと、文字や色を変えられます。</p>`; return; }
  const isBubbleOrText = el.type === "bubble" || el.type === "text";
  const hasFill = el.type === "bubble" || el.type === "shape";
  box.innerHTML = `<div class="card" style="margin:6px 0">
    ${isBubbleOrText ? `<input type="text" id="prText" value="${esc(el.text || "")}" placeholder="文字（絵文字もOK）">` : ""}
    ${hasFill ? `<div class="row"><span class="muted">色</span><div class="palette">${PALETTE.map(c => `<button data-fill="${c}" style="background:${c}" class="${el.fill === c ? "on" : ""}"></button>`).join("")}</div></div>` : ""}
    ${el.type === "text" ? `<div class="row"><span class="muted">文字色</span><div class="palette">${PALETTE.map(c => `<button data-fill="${c}" style="background:${c}" class="${el.color === c ? "on" : ""}"></button>`).join("")}</div></div>` : ""}
    ${isBubbleOrText ? `<div class="row"><span class="muted">文字サイズ</span><input type="range" id="prFont" min="9" max="204" value="${el.font || 15}" style="flex:1"></div>` : ""}
    <div class="tool-row">
      <button id="prFront">前面へ</button><button id="prBack">背面へ</button>
      <button id="prDup">複製</button><button id="prDel">削除</button>
    </div></div>`;
  const t = box.querySelector("#prText"); if (t) t.oninput = () => { el.text = t.value; const n = document.querySelector(`#edCanvas [data-ei="${ED.sel}"] span`); if (n) n.textContent = t.value; };
  box.querySelectorAll("[data-fill]").forEach(b => b.onclick = () => { if (el.type === "text") el.color = b.dataset.fill; else el.fill = b.dataset.fill; renderEditorInto(container); });
  const f = box.querySelector("#prFont"); if (f) f.oninput = () => { el.font = Number(f.value); const need = Math.ceil(el.font / 3) + (el.type === "bubble" ? 6 : 2); if (el.h < need) el.h = Math.min(95, need); const n = document.querySelector(`#edCanvas [data-ei="${ED.sel}"]`); if (n) { n.style.fontSize = ((el.font / 4)).toFixed(2) + "cqw"; n.style.height = el.h + "%"; } };
  box.querySelector("#prDel").onclick = () => { panel.elements.splice(ED.sel, 1); ED.sel = null; renderEditorInto(container); };
  box.querySelector("#prDup").onclick = () => { const c = JSON.parse(JSON.stringify(el)); c.x = Math.min(90, c.x + 4); c.y = Math.min(90, c.y + 4); c.z = panel.elements.length + 1; panel.elements.push(c); ED.sel = panel.elements.length - 1; renderEditorInto(container); };
  box.querySelector("#prFront").onclick = () => { el.z = Math.max(...panel.elements.map(e => e.z || 1)) + 1; renderEditorInto(container); };
  box.querySelector("#prBack").onclick = () => { el.z = Math.min(...panel.elements.map(e => e.z || 1)) - 1; renderEditorInto(container); };
}

/* ---------- create view ---------- */
function renderCreate(parentPost) {
  const main = document.getElementById("main");
  const isCont = !!parentPost;
  main.innerHTML = `
    ${isCont ? `<div class="card"><div class="muted">続きを書く元作品（${esc(parentPost.authorName)}）</div>${parentPost.title ? `<h3 style="margin:4px 0">${esc(parentPost.title)}</h3>` : ""}<div style="max-width:300px">${postBodyHtml(parentPost, true)}</div></div>` : ""}
    <div class="mode-row">
      <button id="modeEd" style="background:var(--accent)">✏️ エディタで描く</button>
      <button id="modeImg" style="background:var(--accent2)">📷 画像で投稿</button>
    </div>
    <div class="ed-wrap" id="createBody"></div>
    <div style="height:12px"></div>
    ${isCont ? "" : `<input type="text" id="postTitle" placeholder="タイトル" maxlength="60">`}
    <div style="height:10px"></div>
    <button class="primary-btn" id="postBtn" style="width:100%">${isCont ? "続きを投稿する" : "投稿する"}</button>`;
  window.scrollTo(0, 0);
  initEditor(isCont);
  let mode = "editor";
  let imgData = { kind: "whole", whole: "", panels: ["", "", "", ""], single: "" };
  const body = document.getElementById("createBody");
  const drawEditor = () => { renderEditorInto(body); };
  const drawImage = () => {
    if (isCont) {
      body.innerHTML = `<p class="muted">続きは1コマだけ。写真を1枚選んでください。</p>
        <label class="primary-btn" style="background:var(--accent2);display:inline-block">📷 写真を選ぶ<input type="file" id="imSingle" accept="image/*" class="hidden"></label>
        <div style="height:8px"></div><div id="imPrev">${imgData.single ? `<div class="panel-box"><img class="panel-img" src="${imgData.single}"></div>` : ""}</div>`;
      document.getElementById("imSingle").onchange = async e => { const f = e.target.files[0]; if (f) { imgData.single = await fileToDataUrl(f); drawImage(); } };
      return;
    }
    body.innerHTML = `<p class="muted">1コマに1枚ずつ、全部で4枚の写真を選んでください（4コマ全体を1枚で投稿はできません）。</p>
      <div id="imArea"></div>`;
    const area = document.getElementById("imArea");
    area.innerHTML = `<div class="panels-preview">${imgData.panels.map((s, i) => `<label class="panel-box" style="cursor:pointer">${s ? `<img class="panel-img" src="${s}">` : `<span class="pnum">${i + 1}コマ目</span><span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px">＋</span>`}<input type="file" data-pi="${i}" accept="image/*" class="hidden"></label>`).join("")}</div>`;
    area.querySelectorAll("[data-pi]").forEach(inp => inp.onchange = async e => { const f = e.target.files[0]; if (f) { imgData.panels[Number(inp.dataset.pi)] = await fileToDataUrl(f); drawImage(); } });
  };
  document.getElementById("modeEd").onclick = () => { mode = "editor"; drawEditor(); };
  document.getElementById("modeImg").onclick = () => { mode = "image"; drawImage(); };
  drawEditor();
  const postKey = "ck" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  let submitting = false;
  document.getElementById("postBtn").onclick = async () => {
    if (submitting) return;
    const btn = document.getElementById("postBtn");
    try {
      let payload;
      if (mode === "editor") {
        payload = { mode: "editor", panels: ED.panels, images: [], parentId: parentPost ? parentPost.id : null, title: isCont ? "" : document.getElementById("postTitle").value, clientKey: postKey };
      } else {
        let images;
        if (isCont) { if (!imgData.single) return toast("写真を選んでください"); images = [imgData.single]; }
        else { if (imgData.panels.some(s => !s)) return toast("4枚すべて選んでください"); images = imgData.panels; }
        payload = { mode: "image", panels: [], images, parentId: parentPost ? parentPost.id : null, title: isCont ? "" : document.getElementById("postTitle").value, clientKey: postKey };
      }
      submitting = true; btn.disabled = true; btn.textContent = "投稿中…";
      await api("/api/posts", { method: "POST", body: JSON.stringify(payload) });
      toast(isCont ? "続きを投稿しました！" : "投稿しました！");
      VIEW = "feed"; SORT = "new"; renderShell();
      if (isCont) setTimeout(() => openChain(parentPost.id), 400);
    } catch (e) { submitting = false; btn.disabled = false; btn.textContent = isCont ? "続きを投稿する" : "投稿する"; toast("投稿できませんでした：" + e.message); }
  };
}

function showZoom(src) {
  closeZoom();
  const z = document.createElement("div");
  z.className = "zoombox"; z.id = "zoombox";
  z.innerHTML = `<img src="${src}" alt="">`;
  z.onclick = closeZoom;
  document.body.appendChild(z);
}
function closeZoom() { const z = document.getElementById("zoombox"); if (z) z.remove(); }
document.addEventListener("click", e => {
  const t = e.target.closest ? e.target.closest("[data-zoom]") : null;
  if (t) { e.stopPropagation(); showZoom(t.getAttribute("data-zoom")); }
}, true);

boot();
