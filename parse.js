// 会社フォルダの Markdown からダッシュボード用のデータを組み立てる。
// PC版（server.js）とスマホ版（GitHub から直接読む）の両方で使う。
// 入力: { "05_projects/xxx/README.md": "中身", ... } の形のファイル一覧
(function (root) {
  const Sprites = typeof module !== 'undefined' && module.exports ? require('./sprites.js') : root.Sprites;

  // このパスのファイルが必要か
  function wanted(p) {
    return /^05_projects\/[^_/][^/]*\/README\.md$/.test(p)
      || /^05_projects\/_inbox\/[^_/][^/]*\.md$/.test(p)
      || (/^05_projects\/_gpt\/[^_/][^/]*\.md$/.test(p) && !/\/README\.md$/.test(p))
      || /^05_projects\/_応募候補\/(done\/)?\d{4}-\d{2}-\d{2}[^/]*\.md$/.test(p)
      || /^00_board\/decisions\/[^_/][^/]*\.md$/.test(p)
      || /^03_reports\/(daily|weekly|monthly|morning)\/\d{4}-\d{2}-\d{2}[^/]*\.md$/.test(p)
      || /^00_board\/answers\/(done\/)?[^_/][^/]*\.md$/.test(p)
      || /^00_board\/meetings\/issue-\d+\.md$/.test(p) // 経営会議（tools/board/mirror.mjs が Issue から書き写す）
      || /^00_board\/intake\/[^_/][^/]*\.md$/.test(p) // 受付（件数だけ出す）
      || p === '00_board/joint/org.json' // 両組織の組織図
      || p === '03_reports/commit-times.json' // 各カードの実際のコミット時刻（あれば。スマホ版用）
      || p === '03_reports/heartbeat.json'
      || p === '01_company/profile.md';
    // 副業（_応募候補_CW）は読まない：上の正規表現は _応募候補/ だけを拾う
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

  // 「## 日程」の表（| 予定日 | 作業 | 担当 | 状態 |）を読む。見出し行・区切り行・ひな形の行は除く
  function schedule(md) {
    const m = md.match(/^##\s+日程\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
    if (!m) return [];
    return m[1].split(/\r?\n/)
      .filter((l) => /^\s*\|/.test(l))
      .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
      .filter((c) => c.length >= 2 && /^\d{4}-\d{2}-\d{2}/.test(c[0]))
      .map((c) => ({ date: c[0], task: c[1] || '', who: c[2] || '', state: c[3] || '' }));
  }

  // 「## ログ」の記録（- YYYY-MM-DD 名前（…）: 内容）を読む。書いた順のまま返す
  // who は（…）を除いた名前（例「テン（オウセン代筆・巡回）」→「テン」）
  function logs(md) {
    return section(md, 'ログ').map((l) => {
      const m = l.match(/^(\d{4}-\d{2}-\d{2})\s+([^:：]+?)\s*[:：]\s*(.*)$/);
      if (!m) return null;
      return { date: m[1], who: m[2].replace(/[（(].*$/, '').trim(), text: m[3].trim() };
    }).filter(Boolean);
  }

  const blank = (v) =>!v || /^（.*）$/.test(v) || /YYYY/.test(v) || v.includes(' / ');
  const base = (p) => p.split('/').pop();
  // 空・見本・「なし」は未記入として扱う
  const val = (v) => (blank(v) || /^(なし|特になし|-|—)$/.test(String(v).trim()) ? '' : String(v).trim());
  // 「進捗」は書かれた数字だけ（0〜100）。無ければ null（日程やチェックの割合から推測しない）
  function progressOf(v) {
    const m = String(v || '').match(/^\s*(\d{1,3})\s*%?\s*$/);
    return m ? Math.max(0, Math.min(100, +m[1])) : null;
  }

  // 各カードの実際のコミット時刻 { パス: ISO }。PC 版は server.js が git log から渡す。無ければ commit-times.json（あれば）
  function commitTimes(files, extra) {
    if (extra && extra.commitTimes) return extra.commitTimes;
    try { return JSON.parse(files['03_reports/commit-times.json'] || '') || {}; } catch (e) { return {}; }
  }

  function projects(files, commits) {
    commits = commits || {};
    const list = [];
    for (const [p, md] of Object.entries(files)) {
      // Claude 側は 05_projects/<案件>/README.md、GPT 側は 05_projects/_gpt/<リポジトリ>_<番号>.md（sync-gpt.js が作る）
      const m = p.match(/^05_projects\/([^_/][^/]*)\/README\.md$/) || p.match(/^05_projects\/(_gpt\/(?!README\.md$)[^/]+)\.md$/);
      if (!m || !md) continue;
      const { out: f, clean } = fields(md);
      const done = (clean.match(/^\s*-\s*\[x\]/gim) || []).length;
      const todo = (clean.match(/^\s*-\s*\[ \]\s*\S/gm) || []).length;
      const stage = blank(f['ステージ']) ? '要件定義' : f['ステージ'];
      const risk = /^あり/.test(f['遅れリスク'] || '') ? (f['遅れリスク'].replace(/^あり\s*[:：]?\s*/, '') || '理由未記入') : '';
      // 障害：カードの「障害」欄。GPT 側の [BLOCKED]（ステージ「止まっている」）も障害として数える
      let blocker = val(f['障害']);
      if (!blocker && stage === '止まっている') blocker = risk || '止まっている';
      const staleDays = parseInt(val(f['古さの基準日数']), 10);
      list.push({
        folder: m[1],
        path: p,
        // どちらの AI の案件か・どの事業部か（2026-11-26 オーナー「クロードとGPTの案件も統合して見れること」）
        source: m[1].startsWith('_gpt/') ? 'GPT' : 'Claude',
        dept: blank(f['事業部']) ? '' : f['事業部'],
        url: /^https?:\/\//.test(f['URL'] || '') ? f['URL'] : '',
        name: title(md) || m[1],
        client: blank(f['クライアント']) ? '' : f['クライアント'],
        kind: blank(f['種別']) ? '' : f['種別'],
        amount: blank(f['金額']) ? '' : f['金額'],
        due: blank(f['納期']) ? '' : f['納期'],
        // 社内締切（納品待ちにする期限。原則、納期の2日前）と遅れリスク（「あり：理由」）
        internalDue: blank(f['社内締切']) ? '' : f['社内締切'],
        risk,
        stage,
        progress: progressOf(f['進捗']), // 数字 または null（未記入）。0 と未記入は区別する
        owner: blank(f['担当']) ? 'オウセン' : f['担当'],
        // 経営会議01の合意で足した項目（書かれていなければ空＝未記入）
        lead: val(f['責任者']),
        updated: val(f['最終更新']),
        blocker,
        working: val(f['作業中']),
        deliverable: /^https?:\/\//.test(val(f['成果物'])) ? val(f['成果物']) : '',
        staleDays: Number.isNaN(staleDays) || staleDays <= 0 ? null : staleDays,
        synced: val(f['同期']),
        doneDate: val(f['完了日']),
        priority: val(f['優先度']),
        commitAt: commits[p] || null, // 実際のコミット時刻（取れなければ null＝未取得）
        next: f['次のアクション'] || '',
        questions: section(clean, 'オーナーへの確認事項'),
        schedule: schedule(clean),
        log: logs(clean),
        tasks: { done, todo },
      });
    }
    return list;
  }

  // 経営会議（00_board/meetings/issue-<番号>.md の冒頭の項目）
  function meetings(files) {
    return Object.entries(files)
      .filter(([p]) => /^00_board\/meetings\/issue-\d+\.md$/.test(p))
      .map(([p, md]) => {
        const { out: f } = fields(md);
        const num = +p.match(/issue-(\d+)/)[1];
        const last = f['最後の発言'] || '';
        const lastAt = (last.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/) || [''])[0];
        const lastWho = last.replace(/\[.*$/, '').replace(/\d{4}-\d{2}-\d{2}T.*$/, '').trim();
        // 相手：発言者のうちオウセン・不明以外でいちばん多い名前
        const count = {};
        for (const mm of md.matchAll(/^##\s*発言\d+（([^・）]+)・/gm)) {
          const n = mm[1].trim();
          if (n !== 'オウセン' && n !== '不明') count[n] = (count[n] || 0) + 1;
        }
        const other = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
        const open = !/閉/.test(f['状態'] || '');
        const ousenWaits = /^はい/.test(f['オウセンの返事待ち'] || '');
        const waiting = !open ? '' : ousenWaits ? 'オウセン' : lastWho === 'オウセン' ? (other || '相手') : '';
        return {
          num,
          name: title(md).replace(/^経営会議\s*#?\d*\s*[:：]\s*/, '') || `経営会議 #${num}`,
          url: /^https?:\/\//.test(f['Issue'] || '') ? f['Issue'] : '',
          open, waiting, lastWho, lastAt,
          posts: parseInt(f['発言数'], 10) || 0,
        };
      })
      .sort((a, b) => b.num - a.num);
  }

  // 受付（00_board/intake/。1件1ファイル、冒頭に「- 状態: 受付中/確定/終了」）。件数だけ使う
  function intake(files) {
    const list = Object.entries(files).filter(([p]) => /^00_board\/intake\/[^_/][^/]*\.md$/.test(p));
    return { total: list.length, open: list.filter(([, md]) => /受付中/.test(fields(md).out['状態'] || '')).length };
  }

  // 組織図（00_board/joint/org.json）。読めなければ null
  function org(files) {
    try { const o = JSON.parse(files['00_board/joint/org.json'] || ''); return o && Array.isArray(o.orgs) ? o : null; } catch (e) { return null; }
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

  // 応募一覧（05_projects/_応募候補/ と done/）。状態の最初の語で分ける
  function applications(files) {
    return Object.entries(files)
      .filter(([p]) => /^05_projects\/_応募候補\/(done\/)?\d{4}-\d{2}-\d{2}[^/]*\.md$/.test(p))
      .map(([p, md]) => {
        const { out: f } = fields(md);
        const raw = (f['状態'] || '').replace(/[（(].*$/, '').trim();
        const status = /受注/.test(raw) ? '受注' : /応募済み/.test(raw) ? '返事待ち'
          : (/見送り|落選|不採用|終了|辞退/.test(raw) || /\/done\//.test(p)) ? '終了' : '送信待ち';
        const am = (f['提案する金額'] || '').match(/[\d,]+円/);
        // 応募文（「## 応募文」の直後のコードブロック）と納期。スマホからコピーして送るため（2026-11-23）
        const sec = md.split(/\n## 応募文/)[1] || '';
        const cb = sec.match(/```[^\n]*\n([\s\S]*?)\n```/);
        const dm = (f['提案する納期'] || '').match(/\d{4}-\d{2}-\d{2}/);
        return {
          path: p, text: cb ? cb[1] : '', due: dm ? dm[0] : '',
          file: base(p), date: base(p).slice(0, 10),
          name: title(md) || base(p).replace(/\.md$/, ''),
          site: blank(f['サイト']) ? '' : f['サイト'].replace(/[（(].*$/, '').trim(),
          url: /^https?:\/\//.test(f['案件URL'] || '') ? f['案件URL'] : '',
          amount: am ? am[0] : '',
          status,
        };
      })
      // 念のための二重の防ぎ：副業のサイトの候補は行ごと出さない
      .filter((a) => !/クラウドワークス|ランサーズ|crowdworks|lancers/i.test(a.site + ' ' + a.url))
      .sort((a, b) => b.date.localeCompare(a.date));
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

  // 毎朝10時のオーナー向け進捗報告（03_reports/morning/ の最新）
  // 副業（クラウドワークス・ランサーズ）を含む行は、報告の欄に出さない（本業の画面に混ぜない）
  const plain = (lines) => lines.filter((l) => !SIDE.test(l));

  function morningReport(files) {
    const names = Object.keys(files).filter((p) => p.startsWith('03_reports/morning/') && p.endsWith('.md')).sort();
    if (!names.length) return null;
    const p = names[names.length - 1];
    const md = files[p];
    // 「なし」や「参考：…」（答えなくてよい補足）は確認事項にしない
    const none = (s) => !/^(なし|特になし)$/.test(s) && !/^参考\s*[:：]/.test(s);
    return {
      path: p,
      date: base(p).slice(0, 10),
      summary: plain(section(md, 'ひとことで')),
      progress: plain(section(md, '昨日からの進み具合')),
      today: plain(section(md, '今日の予定')),
      risks: plain(section(md, '遅れ・リスク')).filter(none),
      asks: plain(section(md, 'オーナーに判断してほしいこと')).filter(none),
      numbers: plain(section(md, '数字')),
    };
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
          summary: plain(section(md, 'ひとことで')).join(' '),
          asks: plain(section(md, 'オーナーに判断してほしいこと')).filter((s) => !/^(なし|特になし)$/.test(s)),
        };
      }
    }
    return null;
  }

  // クラウドのオウセンは1日5回（日本時間 9・12・15・18・21時の20分）巡回する（claude.ai のルーティン。UTC 0・3・6・9・12時）
  const RUN_HOURS_JST = [9, 12, 15, 18, 21];
  const RUN_MINUTE = 20;
  // 直前の予定時刻（巡回が止まったかの判断に使う）
  function prevRun(now) {
    now = now || new Date();
    const jst = new Date(now.getTime() + 9 * 3600e3);
    let best = null;
    for (let d = -1; d <= 0; d++) {
      for (const h of RUN_HOURS_JST) {
        const t = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + d, h, RUN_MINUTE) - 9 * 3600e3;
        if (t <= now.getTime() && (best === null || t > best)) best = t;
      }
    }
    return best === null ? null : new Date(best).toISOString();
  }

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

  // 担当欄（「キョウカイ・オウホン」など複数可）に入っているメンバー名の一覧
  // 「モウテン」に「テン」が含まれるため、区切って1人ずつ判定する
  function members(text) {
    return String(text || '').split(/[・、,，/／&＆+＋\s]+/).map((s) => Sprites.who(s)).filter(Boolean);
  }

  const RECENT_DAYS = 3; // この日数以内にログがあれば「稼働中」とみなす

  function team(list, now) {
    const active = list.filter((p) => !['納品済み', '中止'].includes(p.stage));
    const today = new Date((now ? new Date(now) : new Date()).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    const daysAgo = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
    return Object.entries(Sprites.TEAM).map(([id, t]) => {
      const mine = active.filter((p) => Sprites.who(p.owner) === id);
      // いまの仕事：日程表で担当に名前があり、完了以外の行のうち予定日がいちばん早いもの
      let task = null;
      for (const p of active) {
        for (const r of p.schedule || []) {
          if (/^完了/.test(r.state) || !members(r.who).includes(id)) continue;
          const date = r.date.slice(0, 10);
          if (!task || date < task.date) task = { project: p.name, task: r.task, date, deadline: /社内締切/.test(r.date), state: r.state };
        }
      }
      // 担当している案件の「次のアクション」（最初の1件）
      const np = mine.find((p) => p.next);
      const next = np ? { project: np.name, text: np.next } : null;
      // ログで、その名前で始まる直近の記録（同じ日付なら後に書かれたもの）
      let log = null;
      for (const p of list) {
        for (const l of p.log || []) {
          if (l.who === id && (!log || l.date >= log.date)) log = { project: p.name, date: l.date, text: l.text };
        }
      }
      const recent = !!log && daysAgo(log.date) <= RECENT_DAYS;
      return {
        id, role: t.role, job: t.job, count: mine.length, projects: mine.map((p) => p.name),
        task, next, log,
        busy: mine.length > 0 || !!task || recent, // 担当0件でも、日程やログで動いていれば稼働中
      };
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
    const mr = st.morning;
    if (mr) mr.asks.forEach((t) => add('報告', mr.path, `朝の報告（${mr.date}）`, t));
    const r = st.report;
    if (r) r.asks.forEach((t) => add('報告', r.path, `オウセンの報告（${r.date}）`, t));
    st.projects.forEach((p) => p.questions.forEach((q) => add('確認事項', `05_projects/${p.folder}/README.md`, p.name, q)));
    st.decisions.forEach((d) => add('決裁', `00_board/decisions/${d.file}`, '承認待ち', `決裁: ${d.name}`));
    st.projects
      .filter((p) => p.stage === '納品待ち')
      .forEach((p) => add('納品', `05_projects/${p.folder}/README.md`, p.name, '納品物をクライアントへ送る'));
    return list;
  }

  // 最近の動き：直近のコミット [{ at, subject, author }] → [{ at, who, text }]（48時間以内・15件まで）
  // 誰が：1行目の「名前:」（チームの名前のときだけ）→ board-bot は「経営会議」→ Claude は「巡回」→ それ以外は「PC」
  // 副業の語を含むコミットは出さない
  const SIDE = /クラウドワークス|ランサーズ|応募候補_CW|tenka-cw|crowdworks|lancers|CW/i;
  function recent(list, now) {
    const t0 = (now ? Date.parse(now) : Date.now()) - 48 * 3600e3;
    return (list || [])
      .filter((c) => c && c.at && Date.parse(c.at) >= t0 && !SIDE.test(c.subject || ''))
      .slice(0, 15)
      .map((c) => {
        const subject = String(c.subject || '').split(/\r?\n/)[0].trim();
        const m = subject.match(/^([^:：\s]{1,12})\s*[:：]\s*(.+)$/);
        const named = m && Sprites.who(m[1]);
        const author = String(c.author || '');
        const who = named || (/board-bot/i.test(author) ? '経営会議' : /^claude$/i.test(author) ? '巡回' : 'PC');
        return { at: c.at, who, text: named ? m[2] : subject };
      });
  }

  function buildState(files, extra) {
    extra = extra || {};
    let hb = null;
    try { hb = JSON.parse(files['03_reports/heartbeat.json'] || ''); } catch (e) { hb = null; }
    const list = projects(files, commitTimes(files, extra));
    const st = {
      company: companyName(files),
      repo: extra.repo || '',
      projects: list,
      meetings: meetings(files),
      intake: intake(files),
      org: org(files),
      recent: recent(extra.recent, extra.now),
      team: team(list, extra.now),
      ops: { heartbeat: hb, lastCommit: extra.lastCommit || null, nextRun: nextRun(), prevRun: prevRun(), gptSync: extra.gptSync || null },
      inbox: inbox(files),
      applications: applications(files),
      decisions: decisions(files),
      report: latestReport(files),
      morning: morningReport(files),
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
