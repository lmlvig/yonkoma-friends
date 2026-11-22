import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@libsql/client";

const PORT = process.env.PORT || 3000;
const GATE_PASSWORD = process.env.GATE_PASSWORD || "yonkoma";
const db = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN || "" }
    : { url: "file:local.db" }
);

await db.batch([
  `CREATE TABLE IF NOT EXISTS users (token TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT DEFAULT '🐱', avatar_image TEXT DEFAULT '', created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author_token TEXT NOT NULL, title TEXT DEFAULT '', mode TEXT NOT NULL, panels TEXT DEFAULT '[]', images TEXT DEFAULT '[]', parent_id INTEGER, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS likes (post_id INTEGER NOT NULL, token TEXT NOT NULL, PRIMARY KEY (post_id, token))`,
  `CREATE TABLE IF NOT EXISTS follows (token TEXT NOT NULL, author_token TEXT NOT NULL, PRIMARY KEY (token, author_token))`,
  `CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS post_keys (key TEXT PRIMARY KEY, post_id INTEGER NOT NULL)`,
], "write");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const PUBLIC = join(process.cwd(), "public");

function send(res, code, body, type = "application/json; charset=utf-8") {
  const buf = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { "content-type": type });
  res.end(buf);
}
async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 12_000_000) throw new Error("too big"); chunks.push(c); }
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
async function gated(req) {
  const sid = cookies(req).gate;
  if (!sid) return false;
  const r = await db.execute({ sql: "SELECT sid FROM sessions WHERE sid=?", args: [sid] });
  return r.rows.length > 0;
}
async function userOf(req) {
  const t = req.headers["x-user-token"];
  if (!t) return null;
  const r = await db.execute({ sql: "SELECT * FROM users WHERE token=?", args: [String(t)] });
  return r.rows[0] || null;
}
async function postRow(row, me) {
  const a = await db.execute({ sql: "SELECT name, avatar, avatar_image FROM users WHERE token=?", args: [row.author_token] });
  const author = a.rows[0] || { name: "ななし作家", avatar: "🐱", avatar_image: "" };
  const lc = await db.execute({ sql: "SELECT COUNT(*) c FROM likes WHERE post_id=?", args: [row.id] });
  let liked = false;
  if (me) { const l = await db.execute({ sql: "SELECT 1 FROM likes WHERE post_id=? AND token=?", args: [row.id, me] }); liked = l.rows.length > 0; }
  const cc = await db.execute({ sql: "SELECT COUNT(*) c FROM posts WHERE parent_id=?", args: [row.id] });
  let followed = false;
  if (me) { const f = await db.execute({ sql: "SELECT 1 FROM follows WHERE token=? AND author_token=?", args: [me, row.author_token] }); followed = f.rows.length > 0; }
  let parent = null;
  if (row.parent_id) {
    const p = await db.execute({ sql: "SELECT p.id, p.title, u.name FROM posts p LEFT JOIN users u ON u.token=p.author_token WHERE p.id=?", args: [row.parent_id] });
    if (p.rows[0]) parent = { id: p.rows[0].id, title: p.rows[0].title || "", authorName: p.rows[0].name || "ななし作家" };
  }
  return {
    id: row.id, title: row.title || "", mode: row.mode,
    panels: JSON.parse(row.panels || "[]"), images: JSON.parse(row.images || "[]"),
    parentId: row.parent_id || null, parent, created: row.created,
    authorToken: row.author_token, authorName: author.name, authorAvatar: author.avatar, authorAvatarImage: author.avatar_image || "",
    likeCount: Number(lc.rows[0].c), liked, continuationCount: Number(cc.rows[0].c),
    authorFollowed: followed, mine: me ? row.author_token === me : false,
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;

    if (path === "/api/gate" && req.method === "POST") {
      const { password } = await bodyJson(req);
      if (String(password || "") !== GATE_PASSWORD) return send(res, 401, { error: "合言葉が違います" });
      const sid = randomBytes(24).toString("hex");
      await db.execute({ sql: "INSERT INTO sessions (sid, created) VALUES (?, ?)", args: [sid, Date.now()] });
      res.writeHead(200, { "content-type": "application/json", "set-cookie": `gate=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (path.startsWith("/api/")) {
      if (!(await gated(req))) return send(res, 401, { error: "gate" });
      const me = (await userOf(req))?.token || null;

      if (path === "/api/me" && req.method === "GET") {
        const u = await userOf(req);
        if (!u) return send(res, 200, { user: null });
        const fc = await db.execute({ sql: "SELECT COUNT(*) c FROM follows WHERE author_token=?", args: [u.token] });
        const fg = await db.execute({ sql: "SELECT COUNT(*) c FROM follows WHERE token=?", args: [u.token] });
        return send(res, 200, { user: { token: u.token, name: u.name, avatar: u.avatar, avatarImage: u.avatar_image || "", followers: Number(fc.rows[0].c), following: Number(fg.rows[0].c) } });
      }
      if (path === "/api/me" && req.method === "POST") {
        const b = await bodyJson(req);
        const token = String(b.token || "").slice(0, 64);
        if (!token) return send(res, 400, { error: "token required" });
        const name = String(b.name || "ななし作家").slice(0, 30);
        const avatar = String(b.avatar || "🐱").slice(0, 8);
        const avatarImage = typeof b.avatarImage === "string" && b.avatarImage.startsWith("data:image/") && b.avatarImage.length < 400000 ? b.avatarImage : "";
        await db.execute({ sql: "INSERT INTO users (token, name, avatar, avatar_image, created) VALUES (?,?,?,?,?) ON CONFLICT(token) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, avatar_image=excluded.avatar_image", args: [token, name, avatar, avatarImage, Date.now()] });
        return send(res, 200, { ok: true });
      }
      if (path === "/api/feed" && req.method === "GET") {
        const sort = url.searchParams.get("sort") || "new";
        const r = await db.execute("SELECT * FROM posts WHERE parent_id IS NULL ORDER BY created DESC LIMIT 200");
        let posts = [];
        for (const row of r.rows) posts.push(await postRow(row, me));
        if (sort === "popular") posts.sort((a, b) => b.likeCount - a.likeCount || b.created - a.created);
        else posts.sort((a, b) => (Number(b.authorFollowed) - Number(a.authorFollowed)) || b.created - a.created);
        return send(res, 200, { posts });
      }
      if (path === "/api/posts" && req.method === "POST") {
        if (!me) return send(res, 401, { error: "user required" });
        const b = await bodyJson(req);
        const mode = ["editor", "image"].includes(b.mode) ? b.mode : "editor";
        const panels = Array.isArray(b.panels) ? b.panels : [];
        const images = Array.isArray(b.images) ? b.images.filter(s => typeof s === "string" && s.startsWith("data:image/")) : [];
        const parentId = b.parentId ? Number(b.parentId) : null;
        if (parentId) {
          const total = mode === "editor" ? panels.length : images.length;
          if (total !== 1) return send(res, 400, { error: "続きは1コマだけで投稿してください" });
        } else {
          const total = mode === "editor" ? panels.length : images.length;
          if (mode === "editor" && total !== 4) return send(res, 400, { error: "4コマで投稿してください" });
          if (mode === "image" && !(total === 1 || total === 4)) return send(res, 400, { error: "画像は1枚（全体）か4枚（コマごと）で投稿してください" });
        }
        const clientKey = typeof b.clientKey === "string" ? b.clientKey.slice(0, 64) : "";
        if (clientKey) {
          const dup = await db.execute({ sql: "SELECT post_id FROM post_keys WHERE key=?", args: [me + ":" + clientKey] });
          if (dup.rows[0]) return send(res, 200, { id: Number(dup.rows[0].post_id), duplicate: true });
        }
        const ins = await db.execute({ sql: "INSERT INTO posts (author_token, title, mode, panels, images, parent_id, created) VALUES (?,?,?,?,?,?,?)", args: [me, String(b.title || "").slice(0, 60), mode, JSON.stringify(panels).slice(0, 900000), JSON.stringify(images).slice(0, 9000000), parentId, Date.now()] });
        if (clientKey) await db.execute({ sql: "INSERT OR IGNORE INTO post_keys (key, post_id) VALUES (?,?)", args: [me + ":" + clientKey, Number(ins.lastInsertRowid)] });
        return send(res, 200, { id: Number(ins.lastInsertRowid) });
      }
      const mLike = path.match(/^\/api\/posts\/(\d+)\/like$/);
      if (mLike && req.method === "POST") {
        if (!me) return send(res, 401, { error: "user required" });
        const id = Number(mLike[1]);
        const l = await db.execute({ sql: "SELECT 1 FROM likes WHERE post_id=? AND token=?", args: [id, me] });
        if (l.rows.length) await db.execute({ sql: "DELETE FROM likes WHERE post_id=? AND token=?", args: [id, me] });
        else await db.execute({ sql: "INSERT INTO likes (post_id, token) VALUES (?,?)", args: [id, me] });
        const lc = await db.execute({ sql: "SELECT COUNT(*) c FROM likes WHERE post_id=?", args: [id] });
        return send(res, 200, { likeCount: Number(lc.rows[0].c), liked: !l.rows.length });
      }
      const mDel = path.match(/^\/api\/posts\/(\d+)$/);
      if (mDel && req.method === "DELETE") {
        if (!me) return send(res, 401, { error: "user required" });
        await db.execute({ sql: "DELETE FROM posts WHERE id=? AND author_token=?", args: [Number(mDel[1]), me] });
        await db.execute({ sql: "DELETE FROM likes WHERE post_id=?", args: [Number(mDel[1])] });
        return send(res, 200, { ok: true });
      }
      const mChain = path.match(/^\/api\/chain\/(\d+)$/);
      if (mChain && req.method === "GET") {
        let cur = Number(mChain[1]);
        const root = await db.execute({ sql: "SELECT parent_id FROM posts WHERE id=?", args: [cur] });
        while (root.rows[0]?.parent_id) { cur = root.rows[0].parent_id; const n = await db.execute({ sql: "SELECT parent_id FROM posts WHERE id=?", args: [cur] }); root.rows[0] = n.rows[0]; if (!n.rows[0]) break; }
        const chain = [];
        let id = cur, guard = 0;
        while (id && guard++ < 100) {
          const r = await db.execute({ sql: "SELECT * FROM posts WHERE id=?", args: [id] });
          if (!r.rows[0]) break;
          chain.push(await postRow(r.rows[0], me));
          const child = await db.execute({ sql: "SELECT id FROM posts WHERE parent_id=? ORDER BY created ASC LIMIT 1", args: [id] });
          id = child.rows[0]?.id || null;
        }
        return send(res, 200, { chain });
      }
      const mCont = path.match(/^\/api\/posts\/(\d+)\/continuations$/);
      if (mCont && req.method === "GET") {
        const r = await db.execute({ sql: "SELECT * FROM posts WHERE parent_id=? ORDER BY created ASC", args: [Number(mCont[1])] });
        const out = [];
        for (const row of r.rows) out.push(await postRow(row, me));
        return send(res, 200, { posts: out });
      }
      if (path === "/api/ranking" && req.method === "GET") {
        const r = await db.execute("SELECT * FROM posts WHERE parent_id IS NULL ORDER BY created DESC LIMIT 200");
        let posts = [];
        for (const row of r.rows) posts.push(await postRow(row, me));
        posts.sort((a, b) => b.likeCount - a.likeCount || b.created - a.created);
        return send(res, 200, { posts: posts.slice(0, 30) });
      }
      if (path === "/api/authors" && req.method === "GET") {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        const users = await db.execute("SELECT * FROM users");
        const week = Date.now() - 7 * 24 * 3600 * 1000;
        const out = [];
        for (const u of users.rows) {
          const all = await db.execute({ sql: "SELECT id, title, created FROM posts WHERE author_token=? AND parent_id IS NULL ORDER BY created DESC", args: [u.token] });
          if (!all.rows.length) continue;
          const recent = all.rows.filter(p => Number(p.created) >= week).length;
          const top = all.rows[0];
          let topLikes = -1, topPost = top;
          for (const p of all.rows) { const lc = await db.execute({ sql: "SELECT COUNT(*) c FROM likes WHERE post_id=?", args: [p.id] }); if (Number(lc.rows[0].c) > topLikes) { topLikes = Number(lc.rows[0].c); topPost = p; } }
          const hit = !q || u.name.toLowerCase().includes(q) || all.rows.some(p => (p.title || "").toLowerCase().includes(q));
          if (!hit) continue;
          let followed = false;
          if (me) { const f = await db.execute({ sql: "SELECT 1 FROM follows WHERE token=? AND author_token=?", args: [me, u.token] }); followed = f.rows.length > 0; }
          const fc2 = await db.execute({ sql: "SELECT COUNT(*) c FROM follows WHERE author_token=?", args: [u.token] });
          const fg2 = await db.execute({ sql: "SELECT COUNT(*) c FROM follows WHERE token=?", args: [u.token] });
          out.push({ token: u.token, name: u.name, avatar: u.avatar, avatarImage: u.avatar_image || "", postCount: all.rows.length, recentPosts: recent, onARoll: recent >= 3, topPost: { id: topPost.id, title: topPost.title || "" }, followed, followers: Number(fc2.rows[0].c), following: Number(fg2.rows[0].c), titles: all.rows.map(p => p.title || "") });
        }
        out.sort((a, b) => b.recentPosts - a.recentPosts || b.postCount - a.postCount);
        return send(res, 200, { authors: out });
      }
      const mAuthor = path.match(/^\/api\/author\/(.+)$/);
      if (mAuthor && req.method === "GET") {
        const token = decodeURIComponent(mAuthor[1]);
        const u = await db.execute({ sql: "SELECT * FROM users WHERE token=?", args: [token] });
        if (!u.rows[0]) return send(res, 404, { error: "not found" });
        const user = u.rows[0];
        const fc = await db.execute({ sql: "SELECT COUNT(*) c FROM follows WHERE author_token=?", args: [token] });
        const fg = await db.execute({ sql: "SELECT COUNT(*) c FROM follows WHERE token=?", args: [token] });
        let followed = false;
        if (me) { const f = await db.execute({ sql: "SELECT 1 FROM follows WHERE token=? AND author_token=?", args: [me, token] }); followed = f.rows.length > 0; }
        const pr = await db.execute({ sql: "SELECT * FROM posts WHERE author_token=? AND parent_id IS NULL ORDER BY created DESC LIMIT 50", args: [token] });
        const posts = [];
        for (const row of pr.rows) posts.push(await postRow(row, me));
        return send(res, 200, { user: { token: user.token, name: user.name, avatar: user.avatar, avatarImage: user.avatar_image || "", followers: Number(fc.rows[0].c), following: Number(fg.rows[0].c), followed, mine: me ? me === token : false }, posts });
      }
      const mFollow = path.match(/^\/api\/follow\/(.+)$/);
      if (mFollow && req.method === "POST") {
        if (!me) return send(res, 401, { error: "user required" });
        const target = decodeURIComponent(mFollow[1]);
        const f = await db.execute({ sql: "SELECT 1 FROM follows WHERE token=? AND author_token=?", args: [me, target] });
        if (f.rows.length) await db.execute({ sql: "DELETE FROM follows WHERE token=? AND author_token=?", args: [me, target] });
        else await db.execute({ sql: "INSERT INTO follows (token, author_token) VALUES (?,?)", args: [me, target] });
        return send(res, 200, { followed: !f.rows.length });
      }
      return send(res, 404, { error: "not found" });
    }

    // static
    let file = path === "/" ? "/index.html" : path;
    try {
      const data = await readFile(join(PUBLIC, file));
      return send(res, 200, data, MIME[extname(file)] || "application/octet-stream");
    } catch { return send(res, 404, "not found", "text/plain"); }
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, () => console.log("yonkoma-friends on :" + PORT));
