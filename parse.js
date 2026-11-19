// 会社フォルダの Markdown からダッシュボード用のデータを組み立てる。
// PC版（server.js）とスマホ版（GitHub から直接読む）の両方で使う。
// 入力: { "05_projects/xxx/README.md": "中身", ... } の形のファイル一覧
(function (root) {
  const Sprites = typeof module !== 'undefined' && module.exports ? require('./sprites.js') : root.Sprites;

  // このパスのファイルが必要か
  function wanted(p) {
    return /^05_projects\/[^_/][^/]*\/README\.md$/.test(p)
      || /^05_projects\/_inbox\/[^_/][^/]*\.md$/.test(p)
      || /^00_board\/decisions\/[^_/][^/]*\.md$/.test(p)
      || /^03_reports\/(daily|weekly|monthly)\/\d{4}-\d{2}-\d{2}[^/]*\.md$/.test(p)
      || /^00_board\/answers\/(done\/)?[^_/][^/]*\.md$/.test(p)
      || p === '03_reports/heartbeat.json'
      || p === '01_company/profile.md';
  }

  // 報告書は最新のものだけでよい（取得数を減らす）
  function narrow(paths) {
    const reports = paths.filter((p) => p.startsWith('03_reports/') && p.endsWith('.md')).sort();
    const latest = {};
    for (const p of reports) latest[p.split('/')[1]] = p;
    const keep = new Set(Object.values(latest));
    return paths.filter((p) => !(p.startsWith('03_reports/') && p.endsWith('.md')) || keep.has(p));
  }

  // "- 項目: 値" 形式を拾う（HTMLコメント内は無視）
  function fields(md) {
    const out = {};
    const clean = md.replace(/<!--[\s\S]*?-->/g, '');
    for (const line of clean.split(/\r?\n/)) {
      const m = line.match(/^\s*-\s*([^:：\[\]]+?)\s*[:：]\s*(.*)$/);
      if (m && !(m[1] in out)) out[m[1].trim()] = m[2].trim();
    }
    return { out, clean };
  }

  function title(md) {
    const m = md.match(/^#\s+(.+)$/m);
    return m ? m[1].replace(/^(案件|案件カード)\s*[:：]\s*/, '').trim() : '';
  }

  function section(md, name) {
    const re = new RegExp('^##\\s+' + name + '\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))', 'm');
    const m = md.match(re);
    if (!m) return [];
    return m[1].split(/\r?\n/).map((l) => l.replace(/^\s*[-*]\s*(\[.\]\s*)?/, '').trim()).filter(Boolean);
  }

  const blank = (v) => !v || /^（.*）$/.test(v) || /YYYY/.test(v) || v.includes(' / ');
  const base = (p) => p.split('/').pop();

  function projects(files) {
    const list = [];
    for (const [p, md] of Object.entries(files)) {
      const m = p.match(/^05_projects\/([^_/][^/]*)\/README\.md$/);
      if (!m || !md) continue;
      const { out: f, clean } = fields(md);
      const done = (clean.match(/^\s*-\s*\[x\]/gim) || []).length;
      const todo = (clean.match(/^\s*-\s*\[ \]\s*\S/gm) || []).length;
      let progress = parseInt(f['進捗'], 10);
      if (Number.isNaN(progress)) progress = done + todo ? Math.round((done / (done + todo)) * 100) : 0;
      list.push({
        folder: m[1],
        name: title(md) || m[1],
        client: blank(f['クライアント']) ? '' : f['クライアント'],
        kind: blank(f['種別']) ? '' : f['種別'],
        amount: blank(f['金額']) ? '' : f['金額'],
        due: blank(f['納期']) ? '' : f['納期'],
        // 社内締切（納品待ちにする期限。原則、納期の2日前）と遅れリスク（「あり：理由」）
        internalDue: blank(f['社内締切']) ? '' : f['社内締切'],
        risk: /^あり/.test(f['遅れリスク'] || '') ? (f['遅れリスク'].replace(/^あり\s*[:：]?\s*/, '') || '理由未記入') : '',
        stage: blank(f['ステージ']) ? '要件定義' : f['ステージ'],
        progress: Math.max(0, Math.min(100, progress)),
        owner: blank(f['担当']) ? 'オウセン' : f['担当'],
        next: f['次のアクション'] || '',
        questions: section(clean, 'オーナーへの確認事項'),
        tasks: { done, todo },
      });
    }
    return list;
  }

  function inbox(files) {
    return Object.entries(files)
      .filter(([p]) => /^05_projects\/_inbox\/[^_/][^/]*\.md$/.test(p))
      .map(([p, md]) => {
        const { out: f } = fields(md);
        return {
          file: base(p),
          name: title(md) || base(p).replace(/\.md$/, ''),
          kind: blank(f['種別']) ? '' : f['種別'],
          amount: blank(f['予算（提示額）']) ? '' : f['予算（提示額）'],
          due: blank(f['納期']) ? '' : f['納期'],
          source: blank(f['掲載元']) ? '' : f['掲載元'],
        };
      });
  }

  function decisions(files) {
    return Object.entries(files)
      .filter(([p]) => /^00_board\/decisions\/[^_/][^/]*\.md$/.test(p))
      .map(([p, md]) => {
        const { out: f } = fields(md);
        return { file: base(p), name: title(md).replace(/^決裁\s*[:：]\s*/, ''), status: (f['status'] || '').split(/\s/)[0] };
      })
      .filter((d) => d.status === '起案中');
  }

  function latestReport(files) {
    for (const kind of ['daily', 'weekly', 'monthly']) {
      const names = Object.keys(files).filter((p) => p.startsWith(`03_reports/${kind}/`) && p.endsWith('.md')).sort();
      if (names.length) {
        const p = names[names.length - 1];
        const md = files[p];
        return {
          path: p,
          date: base(p).slice(0, 10),
          kind,
          summary: section(md, 'ひとことで').join(' '),
          asks: section(md, 'オーナーに判断してほしいこと').filter((s) => !/^(なし|特になし)$/.test(s)),
        };
      }
    }
    return null;
  }

  // クラウドのオウセンは24時間、2時間おき（日本時間の奇数時の20分：1:20・3:20…23:20）に巡回する
  const RUN_HOURS_JST = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
  const RUN_MINUTE = 20;
  function nextRun(now) {
    now = now || new Date();
    const jst = new Date(now.getTime() + 9 * 3600e3);
    for (let d = 0; d < 2; d++) {
      for (const h of RUN_HOURS_JST) {
        const t = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + d, h, RUN_MINUTE) - 9 * 3600e3;
        if (t > now.getTime()) return new Date(t).toISOString();
      }
    }
    return null;
  }

  function team(list) {
    const active = list.filter((p) => !['納品済み', '中止'].includes(p.stage));
    return Object.entries(Sprites.TEAM).map(([id, t]) => {
      const mine = active.filter((p) => Sprites.who(p.owner) === id);
      return { id, role: t.role, job: t.job, count: mine.length, projects: mine.map((p) => p.name) };
    });
  }

  function companyName(files) {
    const md = files['01_company/profile.md'] || '';
    const m = md.match(/\|\s*社名\s*\|\s*([^|]*)\|/);
    const n = m ? m[1].trim() : fields(md).out['社名'];
    return blank(n) ? '' : n;
  }

  // ---- オーナー確認事項と回答 ----
  // 確認事項の ID：出どころ（ファイル）と文面から作る短いハッシュ。回答ファイルとの突き合わせに使う
  function askId(target, text) {
    let h = 0x811c9dc5;
    const s = target + '|' + text;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  // 00_board/answers/（未反映）と 00_board/answers/done/（反映済み）の回答
  function answers(files) {
    const out = {};
    for (const [p, md] of Object.entries(files)) {
      const m = p.match(/^00_board\/answers\/(done\/)?[^_/][^/]*\.md$/);
      if (!m) continue;
      const id = fields(md).out['回答ID'];
      if (id) out[id] = { done: !!m[1], answer: fields(md).out['回答'] || '' };
    }
    return out;
  }

  // オーナーに確認してほしいことの一覧（回答済みで反映済みのものは除く）
  function asks(st, ans) {
    const list = [];
    const add = (kind, target, from, text) => {
      const id = askId(target, text);
      const a = ans[id];
      if (a && a.done) return;
      list.push({ id, kind, target, from, text, answered: a ? a.answer : null });
    };
    const r = st.report;
    if (r) r.asks.forEach((t) => add('報告', r.path, `オウセンの報告（${r.date}）`, t));
    st.projects.forEach((p) => p.questions.forEach((q) => add('確認事項', `05_projects/${p.folder}/README.md`, p.name, q)));
    st.decisions.forEach((d) => add('決裁', `00_board/decisions/${d.file}`, '承認待ち', `決裁: ${d.name}`));
    st.projects
      .filter((p) => p.stage === '納品待ち')
      .forEach((p) => add('納品', `05_projects/${p.folder}/README.md`, p.name, '納品物をクライアントへ送る'));
    return list;
  }

  function buildState(files, extra) {
    extra = extra || {};
    let hb = null;
    try { hb = JSON.parse(files['03_reports/heartbeat.json'] || ''); } catch (e) { hb = null; }
    const list = projects(files);
    const st = {
      company: companyName(files),
      projects: list,
      team: team(list),
      ops: { heartbeat: hb, lastCommit: extra.lastCommit || null, nextRun: nextRun() },
      inbox: inbox(files),
      decisions: decisions(files),
      report: latestReport(files),
      sync: extra.sync || { at: null, ok: null, message: '' },
      now: new Date().toISOString(),
    };
    st.asks = asks(st, answers(files));
    return st;
  }

  // 回答ファイル（00_board/answers/ に置く。オウセンが反映したら done/ へ移す）の中身
  function answerFile(ask, answer, comment, at) {
    const one = (s) => String(s || '').replace(/\r?\n/g, ' ').trim();
    return [
      '# オーナーの回答',
      '',
      `- 回答ID: ${ask.id}`,
      `- 種類: ${ask.kind}`,
      `- 対象: ${ask.target}`,
      `- 出どころ: ${one(ask.from)}`,
      `- 質問: ${one(ask.text)}`,
      `- 回答: ${answer}`,
      `- コメント: ${one(comment) || 'なし'}`,
      `- 回答日時: ${at}`,
      '',
    ].join('\n');
  }

  // 回答ファイルの置き場所（日時と ID で一意にする）
  const answerPath = (ask, at) => `00_board/answers/${at.replace(/[-:]/g, '').slice(0, 15)}_${ask.id}.md`;

  const api = { wanted, narrow, buildState, answerFile, answerPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parse = api;
})(this);
