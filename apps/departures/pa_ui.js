/* Passenger announcements – settings page block (inlined by web.py).
   Reads /pa/state and the active skin's font (/pa/font), saves through POST /pa.
   Texts are measured in the board's own font, so the counters and the preview
   match what the board shows. */
(function () {
  var card = document.getElementById('pa_card'), root = document.getElementById('pa_root');
  if (!card || !root) return;
  var SKINS = (card.getAttribute('data-skins') || '').split(' ');
  var S = null, F = null, started = false, timer = null;
  var KEYS = ['fs', 'sc', 'rm'];
  var TITLES = {fs: 'Full-screen PA', sc: 'Scrolling PA', rm: 'Reminder'};
  var HELP = {
    fs: 'Replaces the departures. Each row is fixed or scrolling. While it is on, the Scrolling PA is hidden and reminders are skipped.',
    sc: 'Scrolls in the bottom row, round after round, under the departures.',
    rm: 'Scrolls in the bottom row every few minutes, then gives the row back. Skipped while another PA is on the board.'
  };
  var STATUS = {
    off: 'Off', scheduled: 'Scheduled', live: 'On the board', hidden: 'Hidden while the full-screen PA is on',
    ending: 'Finishing its current pass', waiting: 'On', showing: 'On the board', inactive: 'On (shows with a PA skin)'
  };
  var EVERY = [2, 5, 10, 15, 20, 25, 30, 60];

  function $(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  function gl(c) { return F && Object.prototype.hasOwnProperty.call(F, c) && F[c] instanceof Array ? F[c] : null; }
  function tw(t) {
    if (!t) return 0;
    var w = 0;
    for (var c of t) { var g = gl(c) || gl('_'); w += (g ? g[0] : 5) + 1; }
    return w - 1;
  }
  function missing(t) {
    var o = [];
    for (var c of (t || '')) if (!gl(c) && o.indexOf(c) < 0) o.push(c);
    return o;
  }
  var SAMPLE = 'Forgalmi rend változás, kérjük figyeljék a tájékoztatást';
  function avgChar() { return (tw(SAMPLE) + 1) / SAMPLE.length || 6; }
  function nowLocal() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* --- preview: the board drawn from the font, unsupported characters in red --- */
  function drawText(ctx, t, x, y, s) {
    for (var c of t) {
      var g = gl(c), red = !g;
      if (!g) g = gl('_');
      if (!g) { x += 6; continue; }
      ctx.fillStyle = red ? '#ff4040' : '#ff9e00';
      for (var r = 0; r < 7; r++) {
        var row = g[r + 1], w = g[0];        // row: number (bit w-1 = leftmost) or older "0101" string
        for (var k = 0; k < w; k++) {
          var on = typeof row === 'number' ? Math.floor(row / Math.pow(2, w - 1 - k)) % 2 === 1 : row.charAt(k) === '1';
          if (on) ctx.fillRect((x + k) * s, (y + r) * s, s - 1, s - 1);
        }
      }
      x += g[0] + 1;
    }
    return x;
  }
  function preview(cv, rows) {
    /* rows: one entry per board row: null | {t: text, s: scrolling} */
    var s = 3, W = S.width, H = S.rows * 8;
    cv.width = W * s; cv.height = H * s;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#110b05'; ctx.fillRect(0, 0, cv.width, cv.height);
    rows.forEach(function (r, i) {
      if (!r || !r.t) return;
      drawText(ctx, r.t, 0, 1 + i * 8, s);
    });
  }
  function sepText(sep) { return sep ? sep + ' ' : '     '; }

  /* --- building blocks ----------------------------------------------------- */
  function timeFields(k, p, dis) {
    var sm = p.start ? 'at' : 'now', em = p.end ? 'at' : 'none';
    return '<div class="form-row" style="margin-top:8px;align-items:flex-start">' +
      '<div class="col"><label>Start</label><select id="pa_' + k + '_sm" class="form-control"' + dis + '>' +
      '<option value="now"' + (sm === 'now' ? ' selected' : '') + '>Immediately</option>' +
      '<option value="at"' + (sm === 'at' ? ' selected' : '') + '>At a date and time</option></select>' +
      '<input type="datetime-local" id="pa_' + k + '_st" class="form-control" value="' + esc(p.start) + '"' + dis +
      ' style="margin-top:4px;' + (sm === 'at' ? '' : 'display:none') + '"></div>' +
      '<div class="col"><label>End</label><select id="pa_' + k + '_em" class="form-control"' + dis + '>' +
      '<option value="none"' + (em === 'none' ? ' selected' : '') + '>Permanent (until switched off)</option>' +
      '<option value="at"' + (em === 'at' ? ' selected' : '') + '>At a date and time</option></select>' +
      '<input type="datetime-local" id="pa_' + k + '_en" class="form-control" value="' + esc(p.end) + '"' + dis +
      ' style="margin-top:4px;' + (em === 'at' ? '' : 'display:none') + '"></div></div>';
  }
  function sepField(k, p, dis) {
    return '<div class="form-row" style="margin-top:8px"><div class="col" style="max-width:180px"><label>Separator</label>' +
      '<input type="text" id="pa_' + k + '_sep" class="form-control" maxlength="10" value="' + esc(p.sep) + '"' + dis +
      ' placeholder="empty = gap"></div></div>';
  }
  function head(k, p) {
    var st = p.status || 'off', txt = STATUS[st] || st;
    if (k === 'rm' && st === 'waiting' && S.rm_next_s != null) txt = 'On – next in about ' + Math.max(1, Math.round(S.rm_next_s / 60)) + ' min';
    if (st === 'scheduled' && p.start) txt = 'Scheduled for ' + p.start.replace('T', ' ');
    if ((st === 'live' || st === 'showing') && p.end) txt += ' until ' + p.end.replace('T', ' ');
    var on = !!p.on;
    return '<div class="form-row" style="justify-content:space-between;align-items:center;margin-top:18px">' +
      '<div><b>' + TITLES[k] + '</b> <span id="pa_' + k + '_badge" style="font-size:.75rem;color:var(--muted)">· ' + esc(txt) + '</span></div>' +
      '<button type="button" class="btn btn-sm ' + (on ? 'btn-danger' : 'btn-success') + '" id="pa_' + k + '_btn">' +
      (on ? 'Switch off' : 'Switch on') + '</button></div>' +
      '<div style="font-size:.75rem;color:var(--muted);margin-top:4px">' + HELP[k] +
      (on ? ' Switch it off to edit it.' : '') + '</div>';
  }
  function counter(id) { return '<div id="' + id + '" style="font-size:.72rem;color:var(--muted);margin-top:2px"></div>'; }

  function blockFS(p) {
    var dis = p.on ? ' disabled' : '', h = head('fs', p), rows = p.rows || [];
    for (var i = 0; i < S.rows; i++) {
      var r = rows[i] || {s: 0, t: ''};
      h += '<div class="form-row" style="margin-top:8px;align-items:flex-start">' +
        '<div style="width:150px"><select id="pa_fs_s' + i + '" class="form-control"' + dis + '>' +
        '<option value="0"' + (r.s ? '' : ' selected') + '>Row ' + (i + 1) + ': fixed</option>' +
        '<option value="1"' + (r.s ? ' selected' : '') + '>Row ' + (i + 1) + ': scrolling</option></select></div>' +
        '<div class="col"><input type="text" id="pa_fs_t' + i + '" class="form-control" value="' + esc(r.t) + '"' + dis + '>' +
        counter('pa_fs_c' + i) + '</div></div>';
    }
    h += sepField('fs', p, dis) + timeFields('fs', p, dis);
    h += '<canvas id="pa_fs_pv" style="width:100%;max-width:' + (S.width * 3) + 'px;margin-top:10px;border-radius:4px"></canvas>' +
      '<div style="font-size:.72rem;color:var(--muted)">Preview. Scrolling rows are shown at their start.</div>' +
      '<div id="pa_fs_msg" style="font-size:.8rem;color:#ff6060;margin-top:4px"></div>';
    return h;
  }
  function blockSC(p) {
    var dis = p.on ? ' disabled' : '';
    return head('sc', p) +
      '<div class="form-row" style="margin-top:8px"><div class="col"><textarea id="pa_sc_text" class="form-control" rows="2" maxlength="250"' + dis + '>' +
      esc(p.text) + '</textarea>' + counter('pa_sc_c') + '</div></div>' +
      sepField('sc', p, dis) + timeFields('sc', p, dis) +
      '<canvas id="pa_sc_pv" style="width:100%;max-width:' + (S.width * 3) + 'px;margin-top:10px;border-radius:4px"></canvas>' +
      '<div id="pa_sc_msg" style="font-size:.8rem;color:#ff6060;margin-top:4px"></div>';
  }
  function blockRM(p) {
    var dis = p.on ? ' disabled' : '', loops = '', every = '';
    for (var i = 1; i <= 5; i++) loops += '<option value="' + i + '"' + (p.loops == i ? ' selected' : '') + '>' + i + '</option>';
    EVERY.forEach(function (m) { every += '<option value="' + m + '"' + (p.every == m ? ' selected' : '') + '>every ' + m + ' min</option>'; });
    return head('rm', p) +
      '<div class="form-row" style="margin-top:8px"><div class="col"><textarea id="pa_rm_text" class="form-control" rows="2" maxlength="250"' + dis + '>' +
      esc(p.text) + '</textarea>' + counter('pa_rm_c') + '</div></div>' +
      sepField('rm', p, dis) +
      '<div class="form-row" style="margin-top:8px"><div class="col" style="max-width:160px"><label>Loops each time</label>' +
      '<select id="pa_rm_loops" class="form-control"' + dis + '>' + loops + '</select></div>' +
      '<div class="col" style="max-width:200px"><label>Comes back</label><select id="pa_rm_every" class="form-control"' + dis + '>' + every + '</select></div></div>' +
      '<div id="pa_rm_note" style="font-size:.72rem;color:var(--muted);margin-top:4px"></div>' +
      '<canvas id="pa_rm_pv" style="width:100%;max-width:' + (S.width * 3) + 'px;margin-top:10px;border-radius:4px"></canvas>' +
      '<div id="pa_rm_msg" style="font-size:.8rem;color:#ff6060;margin-top:4px"></div>';
  }

  /* --- live counters and previews ---------------------------------------- */
  function warnMissing(list) { return list.length ? ' · not on the board: ' + esc(list.join(' ')) : ''; }
  function refreshFS() {
    if (!$('pa_fs_pv')) return;
    var rows = [], sep = $('pa_fs_sep').value.trim();
    for (var i = 0; i < S.rows; i++) {
      var t = $('pa_fs_t' + i).value, sc = $('pa_fs_s' + i).value === '1', c = $('pa_fs_c' + i);
      if (sc) {
        c.innerHTML = (250 - t.length) + ' characters left' + warnMissing(missing(t));
        c.style.color = '';
        rows.push(t ? {t: sepText(sep) + t, s: 1} : null);
      } else {
        var left = S.width - tw(t);
        c.innerHTML = (left < 0 ? 'Too wide for a fixed row – shorten it or make it scrolling' :
          'about ' + Math.floor(left / avgChar()) + ' characters left') + warnMissing(missing(t));
        c.style.color = left < 0 ? '#ff6060' : '';
        rows.push(t ? {t: t, s: 0} : null);
      }
    }
    preview($('pa_fs_pv'), rows);
  }
  function refreshBottom(k) {
    var ta = $('pa_' + k + '_text');
    if (!ta) return;
    var t = ta.value, sep = $('pa_' + k + '_sep').value.trim();
    $('pa_' + k + '_c').innerHTML = (250 - t.length) + ' characters left' + warnMissing(missing(t));
    var rows = [];
    for (var i = 0; i < S.rows - 1; i++) rows.push(i === 0 ? {t: '(departures)', s: 0} : null);
    rows.push(t ? {t: sepText(sep) + t, s: 1} : null);
    preview($('pa_' + k + '_pv'), rows);
    if (k === 'rm') {
      var loops = +$('pa_rm_loops').value, every = +$('pa_rm_every').value;
      var px = (tw(sepText(sep) + t) + 1) * loops + tw(sepText(sep)) + S.width;
      var secs = Math.round(px / (avgChar() * ({slow: 3, normal: 4, fast: 5.5}[S.speed] || 4)));
      $('pa_rm_note').innerHTML = 'One reminder takes about ' + (secs >= 90 ? Math.round(secs / 60) + ' min' : secs + ' s') +
        ' at the current speed. A long text with several loops can take longer than the interval, so short intervals keep it on the board most of the time.';
    }
  }

  function wire(k) {
    var b = $('pa_' + k + '_btn');
    if (b) b.onclick = function () { toggle(k); };
    ['sm', 'em'].forEach(function (x) {
      var sel = $('pa_' + k + '_' + x);
      if (sel) sel.onchange = function () { $('pa_' + k + '_' + (x === 'sm' ? 'st' : 'en')).style.display = sel.value === 'at' ? '' : 'none'; };
    });
    if (k === 'fs') {
      for (var i = 0; i < S.rows; i++) (function (i) {
        var inp = $('pa_fs_t' + i), sel = $('pa_fs_s' + i), last = inp.value;
        inp.oninput = function () {
          if (sel.value === '0' && tw(inp.value) > S.width && tw(inp.value) > tw(last)) inp.value = last;  // stop at the edge
          else if (sel.value === '1' && inp.value.length > 250) inp.value = inp.value.slice(0, 250);
          last = inp.value;
          refreshFS();
        };
        sel.onchange = function () { last = inp.value; refreshFS(); };
      })(i);
      $('pa_fs_sep').oninput = refreshFS;
      refreshFS();
    } else {
      $('pa_' + k + '_text').oninput = function () { refreshBottom(k); };
      $('pa_' + k + '_sep').oninput = function () { refreshBottom(k); };
      if (k === 'rm') { $('pa_rm_loops').onchange = $('pa_rm_every').onchange = function () { refreshBottom('rm'); }; }
      refreshBottom(k);
    }
  }

  function render(k) {
    var box = $('pa_box_' + k), p = S.pa[k];
    box.innerHTML = k === 'fs' ? blockFS(p) : (k === 'sc' ? blockSC(p) : blockRM(p));
    wire(k);
  }

  function renderAll() {
    if (!S.enabled) { root.innerHTML = '<div style="color:var(--muted)">This board is too narrow for announcements.</div>'; return; }
    if (!S.skin_ok) {
      root.innerHTML = '<div style="color:var(--muted)">Announcements show with the BKK FUTÁR skin. Once it is running, reload this page to set them up.</div>';
      return;
    }
    var sp = '';
    ['slow', 'normal', 'fast'].forEach(function (v) { sp += '<option value="' + v + '"' + (S.speed === v ? ' selected' : '') + '>' + v.charAt(0).toUpperCase() + v.slice(1) + '</option>'; });
    root.innerHTML =
      '<div class="form-row" style="align-items:center;justify-content:space-between">' +
      '<div style="font-size:.8rem">Box time: <b id="pa_boxtime">' + esc(S.box_time || 'not known yet') + '</b>' +
      '<div style="font-size:.72rem;color:var(--muted)">Start and end times use this clock. It should match your local time.</div></div>' +
      '<div style="width:150px"><label>Scroll speed</label><select id="pa_speed" class="form-control">' + sp + '</select></div></div>' +
      '<div id="pa_box_fs"></div><div id="pa_box_sc"></div><div id="pa_box_rm"></div>';
    $('pa_speed').onchange = function () { post({id: 'speed', speed: $('pa_speed').value}, null); S.speed = $('pa_speed').value; refreshBottom('rm'); };
    KEYS.forEach(render);
  }

  /* --- saving ------------------------------------------------------------ */
  function collect(k) {
    var d = {id: k, on: 1, now: nowLocal(), sep: $('pa_' + k + '_sep').value.trim()};
    if (k !== 'rm') {
      d.start_mode = $('pa_' + k + '_sm').value; d.start = $('pa_' + k + '_st').value;
      d.end_mode = $('pa_' + k + '_em').value; d.end = $('pa_' + k + '_en').value;
    }
    if (k === 'fs') {
      d.rows = [];
      for (var i = 0; i < S.rows; i++) d.rows.push({s: $('pa_fs_s' + i).value === '1' ? 1 : 0, t: $('pa_fs_t' + i).value});
    } else {
      d.text = $('pa_' + k + '_text').value;
    }
    if (k === 'rm') { d.loops = +$('pa_rm_loops').value; d.every = +$('pa_rm_every').value; }
    return d;
  }
  function check(d) {
    if (d.start_mode === 'at' && !d.start) return 'Pick a start date and time.';
    if (d.end_mode === 'at' && !d.end) return 'Pick an end date and time.';
    if (d.end_mode === 'at' && d.start_mode === 'at' && d.end <= d.start) return "The end can't be before the start.";
    if (d.end_mode === 'at' && d.end <= nowLocal()) return 'The end is in the past.';
    return '';
  }
  function post(d, k) {
    return fetch('/pa', {method: 'POST', body: JSON.stringify(d)}).then(function (r) { return r.json(); }).then(function (res) {
      if (k && !res.ok) $('pa_' + k + '_msg').innerHTML = esc(res.msg || 'Not saved.');
      return res;
    }).catch(function () { if (k) $('pa_' + k + '_msg').innerHTML = 'The box did not answer. Try again.'; });
  }
  function toggle(k) {
    var p = S.pa[k], d;
    $('pa_' + k + '_msg').innerHTML = '';
    if (p.on) d = {id: k, on: 0};
    else {
      d = collect(k);
      var err = check(d);
      if (err) { $('pa_' + k + '_msg').innerHTML = err; return; }
    }
    $('pa_' + k + '_btn').disabled = true;
    post(d, k).then(function (res) {
      if (res && res.ok) load(true);
      else if ($('pa_' + k + '_btn')) $('pa_' + k + '_btn').disabled = false;
    });
  }

  /* --- state ------------------------------------------------------------- */
  function load(full) {
    return fetch('/pa/state', {cache: 'no-store'}).then(function (r) { return r.json(); }).then(function (ns) {
      var old = S;
      S = ns;
      if (full || !old || !$('pa_box_fs')) {
        var go = function () { renderAll(); };
        if (!F && S.skin_ok) return fetch('/pa/font').then(function (r) { return r.json(); }).then(function (f) { F = f; go(); });
        go();
        return;
      }
      if ($('pa_boxtime')) $('pa_boxtime').textContent = S.box_time || 'not known yet';
      KEYS.forEach(function (k) {
        if (!!old.pa[k].on !== !!S.pa[k].on) render(k);          // switched on/off (here, by the box or elsewhere)
        else {
          var b = $('pa_' + k + '_badge'), tmp = document.createElement('div');
          tmp.innerHTML = head(k, S.pa[k]);
          var nb = tmp.querySelector('#pa_' + k + '_badge');
          if (b && nb) b.innerHTML = nb.innerHTML;
        }
      });
    }).catch(function () {});
  }

  function start() {
    if (started) return;
    started = true;
    load(true);
    timer = setInterval(function () { if (card.style.display !== 'none') load(false); }, 5000);
  }
  var sk = document.getElementById('skin_select');
  if (sk) sk.addEventListener('change', function () {
    var show = SKINS.indexOf(sk.value) >= 0;
    card.style.display = show ? '' : 'none';
    if (show) { if (started) setTimeout(function () { load(true); }, 1500); else start(); }
  });
  if (card.style.display !== 'none') start();
})();
