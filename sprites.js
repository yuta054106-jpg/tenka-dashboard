// チームのドット絵アバター（16x16）。ブラウザと Node の両方で使う。
// 文字 → 色: . 透明 / h 髪 / s 肌 / e 目 / w 目のハイライト / b ほっぺ / m 口 / c 服 / a 飾り / p 羽根・特徴 / k 黒
(function (root) {
  const BASE = [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '..hhhhhhhhhhhh..',
    '..hhhhhhhhhhhh..',
    '..hhsshhhhsshh..',
    '..hssssssssssh..',
    '..hssewssewssh..',
    '..hsseesseessh..',
    '..hsbssssssbsh..',
    '..hssssmmssssh..',
    '...ssssssssss...',
    '....cccccccc....',
    '...cccaaaaccc...',
    '..ccccaaaacccc..',
    '..cccccccccccc..',
  ].map((r) => r.padEnd(16, '.').slice(0, 16));

  const SKIN = { s: '#ffd9b3', e: '#2b2140', w: '#ffffff', b: '#ff9aa8', m: '#c0504d', k: '#1a1a1a' };

  // 行ごとの差し替え（null はそのまま）
  const TEAM = {
    'オウセン': {
      role: 'CEO', kanji: '王翦', job: 'だいしょうぐん',
      colors: { h: '#5b6475', c: '#3a3f4b', a: '#f2c94c', p: '#e5484d' },
      rows: { 0: '.......pp.......', 1: '....hhhpphhh....', 7: '..hssssssssssh..', 8: '..hsskksskkssh..' },
    },
    'モウテン': {
      role: 'CTO', kanji: '蒙恬', job: 'まほうつかい',
      colors: { h: '#d99a5b', c: '#3d7be0', a: '#ffffff' },
      rows: { 1: '...hhhhhhhhhh...', 5: '..hhsshhsshhhh..' },
    },
    'ヨウタンワ': {
      role: 'デザイン', kanji: '楊端和', job: 'デザイナー',
      colors: { h: '#2a2230', c: '#2f6b4f', a: '#e8d9b0', p: '#d94343' },
      rows: { 0: '..pp........pp..', 4: '..aaaaaaaaaaaa..', 11: '..hssssssssssh..', 12: '..hhcccccccchh..' },
    },
    'キョウカイ': {
      role: 'フロント', kanji: '羌瘣', job: 'フロントエンド',
      colors: { h: '#4a3b52', c: '#5a4fa8', a: '#cfd3e6' },
      rows: { 5: '..hhhhhhhhhhhh..', 11: '..hssssssssssh..' },
    },
    'トウ': {
      role: 'バックエンド', kanji: '騰', job: 'れんけい',
      colors: { h: '#2b2b33', c: '#2e7d6b', a: '#d9d2c5', p: '#2b2b33' },
      rows: { 0: '.....pppppp.....', 8: '..hsseesseessh..', 10: '..hsssmmmmsssh..' },
    },
    'テン': {
      role: 'CMO', kanji: '河了貂', job: 'ぐんし',
      colors: { h: '#3b3546', c: '#ff8c42', a: '#ffe08a', p: '#ffffff' },
      rows: { 0: '..hh........hh..', 1: '..hphhhhhhhhph..' },
    },
    'ショウヘイクン': {
      role: 'CFO', kanji: '昌平君', job: 'けんじゃ',
      colors: { h: '#1f1f2b', c: '#6b4fc2', a: '#f2c94c', p: '#1f1f2b' },
      rows: { 0: '......pppp......', 7: '..hssssssssssh..', 8: '..hsskksskkssh..' },
    },
    'シン': {
      role: 'COO', kanji: '信', job: 'せんし',
      colors: { h: '#262626', c: '#d94343', a: '#e9c9a0' },
      rows: { 0: '..h..hh..hh..h..', 1: '..hhhhhhhhhhhh..' },
    },
    'オウホン': {
      role: '品質管理', kanji: '王賁', job: '品質管理',
      colors: { h: '#3b2a20', c: '#1f3b73', a: '#f2c94c', p: '#f2c94c' },
      rows: { 0: '.......pp.......', 1: '....hhhpphhh....', 7: '..hssssssssssh..', 8: '..hsskksskkssh..' },
    },
    'オーナー': {
      role: 'OWNER', kanji: '', job: 'おうさま',
      colors: { h: '#7a4b2a', c: '#2f5fd0', a: '#f2c94c', p: '#f2c94c' },
      rows: { 0: '....p..pp..p....', 1: '....pppppppp....' },
    },
  };

  function grid(name) {
    const t = TEAM[name];
    const rows = BASE.slice();
    if (t) for (const [i, r] of Object.entries(t.rows)) rows[+i] = r.padEnd(16, '.').slice(0, 16);
    const colors = Object.assign({}, SKIN, t ? t.colors : { h: '#888', c: '#666', a: '#aaa' });
    return { rows, colors };
  }

  function svg(name, size) {
    const { rows, colors } = grid(name);
    let rects = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < 16; x++) {
        const c = colors[row[x]];
        if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
      }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size || 32}" height="${size || 32}" shape-rendering="crispEdges">${rects}</svg>`;
  }

  // 担当欄の文字列から誰かを特定（名前・役職・漢字どれでも可）
  function who(text) {
    const s = String(text || '').toUpperCase();
    for (const [name, t] of Object.entries(TEAM)) {
      if (s.includes(name) || (t.kanji && s.includes(t.kanji)) || s.includes(t.role)) return name;
    }
    if (s.includes('シノ') || s.includes('CEO')) return 'オウセン';
    return null;
  }

  const api = { TEAM, grid, svg, who };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sprites = api;
})(this);
