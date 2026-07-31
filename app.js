/* 中级会计题库 - 核心逻辑 */
(function () {
  'use strict';

  // ============ 状态 ============
  const LS = {
    pat: 'sier_pat', user: 'sier_user', repo: 'sier_repo',
    records: 'sier_records', wrong: 'sier_wrong', fav: 'sier_fav',
    settings: 'sier_settings'
  };
  const DATA_REPO = 'sier-data'; // 私有数据仓库名
  const BANK_URL = 'data/bank.json'; // 本地题库(随前端部署,离线可用)

  let bank = [];
  let state = {
    pat: localStorage.getItem(LS.pat) || '',
    user: localStorage.getItem(LS.user) || '',
    view: 'practice',
    cur: null,        // 当前做题会话
    records: JSON.parse(localStorage.getItem(LS.records) || '{}'),
    wrong: new Set(JSON.parse(localStorage.getItem(LS.wrong) || '[]')),
    fav: new Set(JSON.parse(localStorage.getItem(LS.fav) || '[]')),
    settings: Object.assign({ dailyGoal: 20, examMin: 60 }, JSON.parse(localStorage.getItem(LS.settings) || '{}'))
  };

  // ============ GitHub API ============
  async function ghFetch(path, opts) {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (state.pat) headers['Authorization'] = 'Bearer ' + state.pat;
    const res = await fetch('https://api.github.com' + path, Object.assign({ headers }, opts));
    if (!res.ok) throw new Error('GH ' + res.status);
    return res.json();
  }

  async function syncPull() {
    if (!state.pat) return;
    try {
      setSync('syncing', '同步中…');
      // 拉取做题记录、错题、收藏
      const map = { records: LS.records, wrong: LS.wrong, fav: LS.fav };
      for (const [key, lsKey] of Object.entries(map)) {
        try {
          const d = await ghFetch('/repos/' + state.user + '/' + DATA_REPO + '/contents/data/' + key + '.json');
          const content = JSON.parse(decodeURIComponent(escape(atob(d.content))));
          if (key === 'records') state.records = content;
          else if (key === 'wrong') state.wrong = new Set(content);
          else if (key === 'fav') state.fav = new Set(content);
          localStorage.setItem(lsKey, JSON.stringify(key === 'wrong' || key === 'fav' ? [...state[key === 'wrong' ? 'wrong' : 'fav']] : state.records));
        } catch (e) { /* 文件不存在则忽略 */ }
      }
      setSync('ok', '已同步');
    } catch (e) {
      setSync('err', '同步失败');
    }
  }

  async function syncPush(key) {
    if (!state.pat) return;
    const lsKey = { records: LS.records, wrong: LS.wrong, fav: LS.fav }[key];
    const data = key === 'records' ? state.records : [...state[key]];
    const path = 'data/' + key + '.json';
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    try {
      let sha = null;
      try {
        const existing = await ghFetch('/repos/' + state.user + '/' + DATA_REPO + '/contents/' + path);
        sha = existing.sha;
      } catch (e) { /* 新文件 */ }
      await ghFetch('/repos/' + state.user + '/' + DATA_REPO + '/contents/' + path, {
        method: 'PUT',
        body: JSON.stringify({ message: 'sync ' + key, content, sha })
      });
      localStorage.setItem(lsKey, JSON.stringify(key === 'records' ? state.records : [...state[key]]));
      setSync('ok', '已保存');
    } catch (e) {
      setSync('err', '保存失败');
    }
  }

  function setSync(cls, txt) {
    const el = document.getElementById('sync-status');
    if (el) { el.className = 'sync-status ' + cls; el.textContent = txt; }
  }

  // ============ 数据加载 ============
  async function loadBank() {
    const res = await fetch(BANK_URL);
    bank = await res.json();
    // 计算每卷题量
    window.__bank = bank;
  }

  // ============ 视图切换 ============
  function showView(name) {
    state.view = name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    const content = document.getElementById('content');
    if (name === 'practice') renderPractice(content);
    else if (name === 'wrong') renderWrong(content);
    else if (name === 'stats') renderStats(content);
    else if (name === 'search') renderSearch(content);
    else if (name === 'settings') renderSettings(content);
  }

  // ============ 工具 ============
  function normOpts(q) {
    const order = ['A', 'B', 'C', 'D'];
    const list = order.filter(k => q.options && q.options[k]).map(k => ({ k, v: q.options[k] }));
    return list;
  }
  function isCorrect(q, chosen) {
    if (q.type === 'single') return chosen === q.answer;
    if (q.type === 'multi') {
      if (!chosen.length) return false;
      const a = [...chosen].sort().join('');
      const b = [...q.answer].sort().join('');
      return a === b;
    }
    if (q.type === 'judge') return chosen === q.answer;
    return null; // 主观题
  }
  function qTypeCn(q) { return q.qtype_cn || q.type; }
  function saveRecords() { localStorage.setItem(LS.records, JSON.stringify(state.records)); }
  function saveWrong() { localStorage.setItem(LS.wrong, JSON.stringify([...state.wrong])); }
  function saveFav() { localStorage.setItem(LS.fav, JSON.stringify([...state.fav])); }

  function record(q, ok, mode) {
    const key = String(q.id);
    const t = Date.now();
    if (!state.records[key]) state.records[key] = { id: q.id, cnt: 0, right: 0, wrong: 0, last: t, modes: [] };
    const r = state.records[key];
    r.cnt++; r.last = t;
    if (!r.modes.includes(mode)) r.modes.push(mode);
    if (ok === true) r.right++;
    else if (ok === false) r.wrong++;
    saveRecords();
    if (ok === false) { state.wrong.add(key); saveWrong(); syncPush('wrong'); }
    else if (ok === true) { if (state.wrong.has(key)) { state.wrong.delete(key); saveWrong(); syncPush('wrong'); } }
  }

  function renderStem(q) {
    return `<div class="q-badge">${q.subject} · ${q.kind} · ${q.vol.replace('年·' + q.subject + '·', '')} · ${qTypeCn(q)}</div>` +
           `<div class="q-stem">${escapeHtml(q.stem)}</div>`;
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============ 做题会话 ============
  function startQuiz(list, mode, options) {
    options = options || {};
    state.cur = { list, idx: 0, answers: {}, graded: {}, mode, timer: options.timer || 0, start: Date.now(), interval: null };
    openOverlay();
    renderQuiz();
    if (state.cur.timer) {
      state.cur.interval = setInterval(() => {
        const remain = state.cur.timer - Math.floor((Date.now() - state.cur.start) / 1000);
        const el = document.getElementById('quiz-timer');
        if (el) el.textContent = '⏱ ' + fmtTime(Math.max(0, remain));
        if (remain <= 0) { clearInterval(state.cur.interval); state.cur.timer = 0; submitExam(); }
      }, 1000);
    }
  }

  function fmtTime(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function renderQuiz() {
    const cur = state.cur;
    const q = cur.list[cur.idx];
    const body = document.getElementById('quiz-body');
    const total = cur.list.length;
    const progress = document.getElementById('quiz-progress');
    progress.textContent = `第 ${cur.idx + 1}/${total} 题`;
    const timer = document.getElementById('quiz-timer');
    if (cur.timer) {
      const remain = cur.timer - Math.floor((Date.now() - cur.start) / 1000);
      timer.textContent = '⏱ ' + fmtTime(Math.max(0, remain));
    } else timer.textContent = '';

    let html = renderStem(q);
    const chosen = cur.answers[q.id] || [];

    if (q.type === 'single') {
      html += '<div>';
      normOpts(q).forEach(o => {
        html += `<div class="opt ${chosen.includes(o.k) ? 'selected' : ''}" data-opt="${o.k}">
          <span class="letter">${o.k}</span><span class="otext">${escapeHtml(o.v)}</span></div>`;
      });
      html += '</div>';
    } else if (q.type === 'multi') {
      html += '<div class="hint">多选：可点选多个</div>';
      normOpts(q).forEach(o => {
        html += `<div class="opt ${chosen.includes(o.k) ? 'selected' : ''}" data-opt="${o.k}">
          <span class="letter">${o.k}</span><span class="otext">${escapeHtml(o.v)}</span></div>`;
      });
      html += '</div>';
    } else if (q.type === 'judge') {
      html += '<div class="judge-opt">';
      [['√', '√'], ['×', '×']].forEach(([k, label]) => {
        html += `<div class="opt ${chosen.includes(k) ? 'selected' : ''}" data-opt="${k}"><span class="letter">${label}</span><span class="otext">${label}</span></div>`;
      });
      html += '</div>';
    } else {
      // 主观题
      html += '<div class="subj-answer"><textarea placeholder="在纸上作答后，对照答案自评，或在此记录要点…" data-subj-answer></textarea></div>';
    }

    // 答案面板(已判分后)
    if (cur.graded[q.id] !== undefined) {
      const verdict = cur.graded[q.id];
      html += '<div class="answer-panel">';
      if (q.type === 'calc' || q.type === 'comprehensive') {
        html += `<div class="a-verdict ${verdict ? 'verdict-right' : 'verdict-wrong'}">${verdict ? '✓ 自评正确' : '✗ 自评错误'}</div>`;
      } else {
        html += `<div class="a-verdict ${verdict ? 'verdict-right' : 'verdict-wrong'}">${verdict ? '✓ 回答正确' : '✗ 回答错误'}</div>`;
        html += `<h4>正确答案：${escapeHtml(q.answer)}</h4>`;
      }
      html += `<h4>解析</h4><div class="a-content">${escapeHtml(q.analysis || '(无解析)')}</div>`;
      html += `<h4>参考答案</h4><div class="a-content">${escapeHtml(q.type === 'calc' || q.type === 'comprehensive' ? q.answer : q.answer)}</div>`;
      html += '</div>';
    }

    // 操作按钮
    html += '<div class="q-actions">';
    const faved = state.fav.has(String(q.id));
    html += `<button class="btn ghost fav-icon" id="btn-fav">${faved ? '★ 已收藏' : '☆ 收藏'}</button>`;
    html += '</div>';

    if (cur.graded[q.id] === undefined) {
      html += '<div class="quiz-nav"><button class="btn primary" id="btn-submit">交卷 / 判分</button></div>';
    } else {
      html += '<div class="quiz-nav">';
      if (cur.idx > 0) html += '<button class="btn ghost" id="btn-prev">上一题</button>';
      if (cur.idx < total - 1) html += '<button class="btn primary" id="btn-next">下一题</button>';
      else if (cur.mode !== 'exam') html += '<button class="btn green" id="btn-finish">完成</button>';
      else html += '<button class="btn green" id="btn-finish">交卷出分</button>';
      html += '</div>';
    }

    body.innerHTML = html;
    bindQuizEvents(q);
  }

  function bindQuizEvents(q) {
    const cur = state.cur;
    // 选项点击
    document.querySelectorAll('.opt').forEach(el => {
      el.addEventListener('click', () => {
        if (cur.graded[q.id] !== undefined) return;
        const k = el.dataset.opt;
        let chosen = cur.answers[q.id] || [];
        if (q.type === 'multi') {
          chosen = chosen.includes(k) ? chosen.filter(x => x !== k) : [...chosen, k];
        } else {
          chosen = [k];
        }
        cur.answers[q.id] = chosen;
        // 重新渲染选项状态
        document.querySelectorAll('.opt').forEach(o => {
          o.classList.toggle('selected', chosen.includes(o.dataset.opt));
        });
      });
    });
    // 收藏
    const favBtn = document.getElementById('btn-fav');
    if (favBtn) favBtn.addEventListener('click', () => {
      const id = String(q.id);
      if (state.fav.has(id)) { state.fav.delete(id); favBtn.textContent = '☆ 收藏'; }
      else { state.fav.add(id); favBtn.textContent = '★ 已收藏'; }
      saveFav(); syncPush('fav');
    });
    // 交卷
    const submit = document.getElementById('btn-submit');
    if (submit) submit.addEventListener('click', () => grade(q));
    const prev = document.getElementById('btn-prev');
    if (prev) prev.addEventListener('click', () => { cur.idx--; renderQuiz(); });
    const next = document.getElementById('btn-next');
    if (next) next.addEventListener('click', () => { cur.idx++; renderQuiz(); });
    const finish = document.getElementById('btn-finish');
    if (finish) finish.addEventListener('click', () => finishQuiz());
  }

  function grade(q) {
    const cur = state.cur;
    const chosen = cur.answers[q.id] || [];
    if (q.type === 'calc' || q.type === 'comprehensive') {
      // 主观题: 需自评
      renderSelfGrade(q, chosen);
      return;
    }
    const ok = isCorrect(q, chosen);
    cur.graded[q.id] = ok;
    // 客观题: 高亮
    const body = document.getElementById('quiz-body');
    document.querySelectorAll('.opt').forEach(el => {
      el.classList.add('disabled');
      const k = el.dataset.opt;
      if (q.type === 'single' || q.type === 'judge') {
        if (k === q.answer) el.classList.add('correct');
        if (chosen.includes(k) && k !== q.answer) el.classList.add('wrong');
      } else {
        if (q.answer.includes(k)) el.classList.add('correct');
        if (chosen.includes(k) && !q.answer.includes(k)) el.classList.add('wrong');
      }
    });
    record(q, ok, cur.mode);
    renderQuiz();
  }

  function renderSelfGrade(q, chosen) {
    const cur = state.cur;
    const body = document.getElementById('quiz-body');
    // 显示参考答案并让用户自评
    let html = renderStem(q);
    html += '<div class="answer-panel">';
    html += `<h4>参考答案</h4><div class="a-content">${escapeHtml(q.answer || '(无)')}</div>`;
    html += `<h4>解析</h4><div class="a-content">${escapeHtml(q.analysis || '(无)')}</div>`;
    html += '</div>';
    html += '<div class="subj-answer self-grade"><div class="self-grade">';
    html += '<button class="btn green" id="btn-self-right">✓ 答对了</button>';
    html += '<button class="btn red" id="btn-self-wrong">✗ 答错了</button>';
    html += '</div></div>';
    body.innerHTML = html;
    document.getElementById('btn-self-right').addEventListener('click', () => { cur.graded[q.id] = true; record(q, true, cur.mode); renderQuiz(); });
    document.getElementById('btn-self-wrong').addEventListener('click', () => { cur.graded[q.id] = false; record(q, false, cur.mode); renderQuiz(); });
  }

  function finishQuiz() {
    const cur = state.cur;
    if (cur.interval) clearInterval(cur.interval);
    closeOverlay();
    if (cur.mode === 'exam') {
      // 模拟考出分
      let right = 0, wrong = 0, total = 0;
      cur.list.forEach(q => {
        const ok = cur.graded[q.id];
        if (q.type === 'calc' || q.type === 'comprehensive') {
          if (ok === true) right++;
          else if (ok === false) wrong++;
          else return;
        } else {
          total++;
          if (ok === true) right++;
          else if (ok === false) wrong++;
        }
      });
      const score = total > 0 ? Math.round(right / total * 100) : 0;
      const elapsed = Math.floor((Date.now() - cur.start) / 1000);
      alert(`本次模拟考完成！\n共 ${cur.list.length} 题\n正确 ${right} · 错误 ${wrong}\n得分率 ${score}%\n用时 ${fmtTime(elapsed)}`);
    } else {
      // 练习完成
      const graded = Object.keys(cur.graded).length;
      alert(`本组练习完成！已作答 ${graded}/${cur.list.length} 题`);
    }
    state.cur = null;
    showView(state.view);
  }

  // ============ 练习视图 ============
  function renderPractice(content) {
    const subs = ['财管', '实务'];
    let html = '<div class="card"><h3>选择科目</h3><div class="chip-row">';
    subs.forEach(s => {
      const count = bank.filter(q => q.subject === s).length;
      html += `<div class="chip" data-subj="${s}">${s}（${count}题）</div>`;
    });
    html += '</div></div>';
    html += '<div class="card"><h3>练习方式</h3>';
    html += '<div class="btn-row">';
    html += '<button class="btn primary" id="btn-byvol">按卷练习</button>';
    html += '<button class="btn green" id="btn-random">随机 20 题</button>';
    html += '<button class="btn ghost" id="btn-mock">模拟考</button>';
    html += '</div></div>';
    content.innerHTML = html;

    let subj = '财管';
    document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      subj = c.dataset.subj;
      document.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === c));
    }));
    document.getElementById('btn-byvol').addEventListener('click', () => renderVolSelect(content, subj));
    document.getElementById('btn-random').addEventListener('click', () => {
      const list = shuffle(bank.filter(q => q.subject === subj)).slice(0, 20);
      startQuiz(list, 'practice');
    });
    document.getElementById('btn-mock').addEventListener('click', () => renderMockSetup(content, subj));
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderVolSelect(content, subj) {
    // 收集该科目的卷
    const vols = [];
    const seen = new Set();
    bank.filter(q => q.subject === subj).forEach(q => {
      if (!seen.has(q.vol)) { seen.add(q.vol); vols.push(q.vol); }
    });
    let html = '<div class="card"><h3>选择卷</h3>';
    html += `<button class="btn ghost" id="btn-back" style="width:auto;padding:8px 14px;font-size:14px;">← 返回</button></div>`;
    vols.forEach(v => {
      const qs = bank.filter(q => q.vol === v);
      html += `<div class="vol-item" data-vol="${v}">
        <span class="vname">${v.replace('年·' + subj + '·', ' 年 ')}</span>
        <span class="vmeta">${qs.length} 题</span></div>`;
    });
    content.innerHTML = html;
    document.getElementById('btn-back').addEventListener('click', () => showView('practice'));
    document.querySelectorAll('.vol-item').forEach(el => el.addEventListener('click', () => {
      renderVolDetail(content, subj, el.dataset.vol);
    }));
  }

  function renderVolDetail(content, subj, vol) {
    const qs = bank.filter(q => q.vol === vol);
    const types = {};
    qs.forEach(q => { types[q.qtype_cn] = (types[q.qtype_cn] || 0) + 1; });
    let html = `<div class="card"><h3>${vol.replace('年·' + subj + '·', ' 年 ')}</h3>`;
    html += `<button class="btn ghost" id="btn-back" style="width:auto;padding:8px 14px;font-size:14px;">← 返回</button></div>`;
    html += '<div class="card"><h3>题型</h3><div class="chip-row">';
    Object.keys(types).forEach(t => {
      html += `<div class="chip" data-type="${t}">${t}（${types[t]}题）</div>`;
    });
    html += '</div><button class="btn primary" id="btn-start" style="margin-top:14px;">开始本卷</button></div>';
    content.innerHTML = html;
    let selTypes = new Set(Object.keys(types));
    document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      const t = c.dataset.type;
      if (selTypes.has(t)) { selTypes.delete(t); c.classList.remove('active'); }
      else { selTypes.add(t); c.classList.add('active'); }
    }));
    document.querySelectorAll('.chip').forEach(c => c.classList.add('active'));
    document.getElementById('btn-back').addEventListener('click', () => renderVolSelect(content, subj));
    document.getElementById('btn-start').addEventListener('click', () => {
      const list = qs.filter(q => selTypes.has(q.qtype_cn));
      startQuiz(list, 'practice');
    });
  }

  // ============ 模拟考 ============
  function renderMockSetup(content, subj) {
    content.innerHTML = `<div class="card"><h3>模拟考设置</h3>
      <div class="chip-row"><span class="label">科目</span><div class="chip active">${subj}</div></div>
      <div class="set-row"><span class="lbl">抽题数量</span><input type="number" id="mock-num" value="40" min="5" max="80"></div>
      <div class="set-row"><span class="lbl">限时（分钟）</span><input type="number" id="mock-min" value="60" min="5" max="180"></div>
      <button class="btn primary" id="btn-start-mock" style="margin-top:16px;">开始模拟考</button>
      <button class="btn ghost" id="btn-back" style="margin-top:8px;">← 返回</button></div>`;
    document.getElementById('btn-start-mock').addEventListener('click', () => {
      const n = parseInt(document.getElementById('mock-num').value) || 40;
      const min = parseInt(document.getElementById('mock-min').value) || 60;
      const list = shuffle(bank.filter(q => q.subject === subj)).slice(0, n);
      startQuiz(list, 'exam', { timer: min * 60 });
    });
    document.getElementById('btn-back').addEventListener('click', () => showView('practice'));
  }

  // ============ 错题本 ============
  function renderWrong(content) {
    const ids = [...state.wrong];
    const list = bank.filter(q => ids.includes(String(q.id)));
    let html = `<div class="card"><h3>错题本（${list.length} 题）</h3>`;
    html += '<button class="btn green" id="btn-wrong-practice" style="margin-top:10px;">重练全部错题</button>';
    html += '<button class="btn ghost" id="btn-wrong-print" style="margin-top:8px;">打印 / 导出错题</button>';
    html += '</div>';
    if (list.length === 0) {
      html += '<div class="card" style="color:var(--muted);text-align:center;">暂无错题，加油！</div>';
    } else {
      list.slice(0, 30).forEach(q => {
        html += `<div class="search-result" data-qid="${q.id}">
          <div class="q-meta">${q.subject} · ${q.vol.replace('年·' + q.subject + '·', '')} · ${qTypeCn(q)}</div>
          <div class="q-stem">${escapeHtml(q.stem.slice(0, 80))}…</div></div>`;
      });
      if (list.length > 30) html += '<div class="card" style="text-align:center;color:var(--muted);font-size:13px;">仅显示前 30 条，全部可在打印中查看</div>';
    }
    content.innerHTML = html;
    document.getElementById('btn-wrong-practice').addEventListener('click', () => {
      if (list.length) startQuiz(list, 'practice');
    });
    document.getElementById('btn-wrong-print').addEventListener('click', () => printWrong(list));
    document.querySelectorAll('.search-result').forEach(el => el.addEventListener('click', () => {
      const q = bank.find(x => x.id === parseInt(el.dataset.qid));
      if (q) startQuiz([q], 'practice');
    }));
  }

  function printWrong(list) {
    if (!list.length) return;
    const win = window.open('', '_blank');
    let html = '<html><head><meta charset="utf-8"><title>错题本</title><style>';
    html += 'body{font-family:-apple-system,"PingFang SC",sans-serif;padding:24px;color:#222;}';
    html += 'h1{font-size:20px;} .q{margin-bottom:18px;page-break-inside:avoid;border-bottom:1px solid #ddd;padding-bottom:14px;}';
    html += '.stem{font-size:15px;margin-bottom:8px;} .ans{font-size:13px;color:#555;}';
    html += '.exp{font-size:13px;color:#777;margin-top:6px;white-space:pre-wrap;}';
    html += '</style></head><body><h1>中级会计 · 错题本（' + list.length + ' 题）</h1>';
    list.forEach(q => {
      html += `<div class="q"><div class="stem">【${q.subject} · ${q.vol.replace('年·' + q.subject + '·', '')} · ${qTypeCn(q)}】${escapeHtml(q.stem)}</div>`;
      html += `<div class="ans">答案：${escapeHtml(q.answer || '')}</div>`;
      if (q.analysis) html += `<div class="exp">解析：${escapeHtml(q.analysis)}</div>`;
      html += '</div>';
    });
    html += '</body></html>';
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }

  // ============ 统计 ============
  function renderStats(content) {
    const recs = Object.values(state.records);
    const total = recs.length;
    const right = recs.reduce((s, r) => s + r.right, 0);
    const wrong = recs.reduce((s, r) => s + r.wrong, 0);
    const answered = right + wrong;
    const rate = answered ? Math.round(right / answered * 100) : 0;
    let html = '<div class="stat-grid">';
    html += `<div class="stat-item"><div class="num">${total}</div><div class="lbl">已做题目</div></div>`;
    html += `<div class="stat-item"><div class="num">${rate}%</div><div class="lbl">正确率</div></div>`;
    html += `<div class="stat-item"><div class="num">${right}</div><div class="lbl">答对</div></div>`;
    html += `<div class="stat-item"><div class="num">${wrong}</div><div class="lbl">答错</div></div>`;
    html += '</div>';
    // 按科目
    ['财管', '实务'].forEach(subj => {
      const rs = recs.filter(r => bank.find(q => q.id === r.id)?.subject === subj);
      if (rs.length) {
        const r = rs.reduce((s, x) => s + x.right, 0);
        const w = rs.reduce((s, x) => s + x.wrong, 0);
        const pct = (r + w) ? Math.round(r / (r + w) * 100) : 0;
        html += `<div class="card"><h3>${subj}</h3><div class="bar-row"><span>${subj}</span><div class="bar"><div style="width:${pct}%"></div></div><span>${pct}%</span></div></div>`;
      }
    });
    html += '<div class="card"><h3>最近活动</h3>';
    const recent = recs.sort((a, b) => b.last - a.last).slice(0, 5);
    if (recent.length === 0) html += '<div style="color:var(--muted);">还没有做题记录，去刷题吧！</div>';
    recent.forEach(r => {
      const q = bank.find(x => x.id === r.id);
      if (q) html += `<div class="bar-row"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${q.vol.replace('年·' + q.subject + '·', '')} ${qTypeCn(q)}</span><span>${new Date(r.last).toLocaleDateString()}</span></div>`;
    });
    html += '</div>';
    content.innerHTML = html;
  }

  // ============ 搜题 ============
  let searchTimer = null;
  function renderSearch(content) {
    content.innerHTML = `<div class="card"><h3>搜题</h3>
      <input class="search-input" id="search-input" placeholder="输入关键词，如：年金、存货、所得税…">
      <div id="search-results"></div></div>`;
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const kw = input.value.trim();
        if (!kw) { results.innerHTML = ''; return; }
        const hits = bank.filter(q => (q.stem + (q.answer || '') + (q.analysis || '')).includes(kw)).slice(0, 30);
        if (hits.length === 0) { results.innerHTML = '<div style="color:var(--muted);">未找到相关题目</div>'; return; }
        results.innerHTML = hits.map(q => `<div class="search-result" data-qid="${q.id}">
          <div class="q-meta">${q.subject} · ${q.vol.replace('年·' + q.subject + '·', '')} · ${qTypeCn(q)}</div>
          <div class="q-stem">${escapeHtml(q.stem.slice(0, 70))}…</div></div>`).join('');
        results.querySelectorAll('.search-result').forEach(el => el.addEventListener('click', () => {
          const q = bank.find(x => x.id === parseInt(el.dataset.qid));
          if (q) startQuiz([q], 'practice');
        }));
      }, 300);
    });
  }

  // ============ 设置 ============
  function renderSettings(content) {
    content.innerHTML = `<div class="card"><h3>设置</h3>
      <div class="set-row"><span class="lbl">每日目标</span><input type="number" id="set-goal" value="${state.settings.dailyGoal}" min="5" max="200"></div>
      <div class="set-row"><span class="lbl">同步令牌</span><span id="set-token-desc" style="font-size:12px;color:var(--muted);"></span></div>
      <div class="set-row"><span class="lbl">同步用户</span><span id="set-user" style="font-size:14px;"></span></div>
      <button class="btn primary" id="btn-save-settings">保存设置</button>
      <button class="btn ghost" id="btn-sync-now">立即同步</button>
      <button class="btn ghost" id="btn-clear-data">清除本地数据</button>
      </div>`;
    document.getElementById('set-token-desc').textContent = state.pat ? '已设置（' + state.pat.slice(0, 8) + '…）' : '未设置';
    document.getElementById('set-user').textContent = state.user || '未设置';
    document.getElementById('btn-save-settings').addEventListener('click', () => {
      state.settings.dailyGoal = parseInt(document.getElementById('set-goal').value) || 20;
      localStorage.setItem(LS.settings, JSON.stringify(state.settings));
      alert('已保存');
    });
    document.getElementById('btn-sync-now').addEventListener('click', () => syncPull().then(() => alert('同步完成')));
    document.getElementById('btn-clear-data').addEventListener('click', () => {
      if (confirm('确定清除本地所有做题数据？')) {
        localStorage.removeItem(LS.records); localStorage.removeItem(LS.wrong); localStorage.removeItem(LS.fav);
        state.records = {}; state.wrong = new Set(); state.fav = new Set();
        alert('已清除');
        showView('settings');
      }
    });
  }

  // ============ 登录 / 弹层 ============
  function openOverlay() { document.getElementById('quiz-overlay').classList.remove('hidden'); }
  function closeOverlay() { document.getElementById('quiz-overlay').classList.add('hidden'); }

  async function doLogin(pat, user) {
    state.pat = pat.trim();
    state.user = user.trim();
    localStorage.setItem(LS.pat, state.pat);
    localStorage.setItem(LS.user, state.user);
    // 验证令牌
    try {
      const me = await ghFetch('/user');
      document.getElementById('login-error').textContent = '';
      showHome();
      syncPull();
    } catch (e) {
      document.getElementById('login-error').textContent = '令牌无效或网络错误，请检查（需勾选 repo 权限）。';
      state.pat = ''; state.user = '';
      localStorage.removeItem(LS.pat); localStorage.removeItem(LS.user);
    }
  }

  function showHome() {
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('view-home').classList.remove('hidden');
    showView('practice');
  }

  // ============ 初始化 ============
  async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    document.getElementById('btn-login').addEventListener('click', () => {
      doLogin(document.getElementById('login-pat').value, document.getElementById('login-user').value);
    });
    document.getElementById('help-token').addEventListener('click', () => {
      alert('获取令牌步骤：\n1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens\n2. 点 Generate new token\n3. Repository access 选 Only select repositories → 选择 sier-data 仓库\n4. Permissions → Repository permissions → Contents 设为 Read and write\n5. 生成后复制令牌（github_pat_ 开头）');
    });
    document.getElementById('btn-logout').addEventListener('click', () => {
      state.pat = ''; state.user = '';
      localStorage.removeItem(LS.pat); localStorage.removeItem(LS.user);
      location.reload();
    });
    document.getElementById('btn-quiz-close').addEventListener('click', () => {
      if (state.cur && state.cur.interval) clearInterval(state.cur.interval);
      closeOverlay();
    });
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

    await loadBank();
    if (state.pat) { showHome(); syncPull(); }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
