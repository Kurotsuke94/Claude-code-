(function () {
  'use strict';

  // ── MX.Charts — graphique SVG multi-séries partagé ──
  // Extrait et généralisé depuis assets/js/pages/cta-vc.js:_lineChartSvg
  // (même technique que assets/js/pages/consommations.js:_bezierLineSVG :
  // SVG inline construit en chaîne, aucune dépendance externe ajoutée).
  //
  // Différences volontaires avec _lineChartSvg d'origine :
  //  - échelle Y jamais basée sur zéro : [min-marge, max+marge], marge =
  //    10% de l'amplitude, avec un plancher d'amplitude de 1 (évite un
  //    graphique illisible quand toutes les valeurs sont quasi identiques) ;
  //  - une valeur manquante (null/undefined) NE relie JAMAIS deux points
  //    valides entre eux (contrairement à l'ancien code, qui filtrait
  //    silencieusement les null et traçait un trait continu par-dessus) ;
  //  - si un `ts` (timestamp ms) est fourni par point, un écart temporel
  //    entre deux points valides consécutifs supérieur à `opts.gapDays`
  //    (défaut 7 jours) casse également le tracé, même si les deux valeurs
  //    existent — pas de continuité suggérée sur une longue absence de
  //    données ;
  //  - tooltips (survol desktop / tap mobile) sur chaque point ;
  //  - légende cliquable pour masquer/afficher une série (recalcule
  //    l'échelle sur les séries visibles restantes) ;
  //  - message "données insuffisantes" avec la raison exacte (N dispo vs M
  //    requis), jamais un graphique vide sans explication.
  //
  // Forme d'une série : { label, color, vals: (number|null)[], labels:
  // string[], ts?: (number|null)[] } — `ts` (epoch ms) est optionnel ;
  // sans lui, aucune coupure par écart temporel n'est appliquée (seules les
  // valeurs manquantes cassent le tracé).

  var DAY_MS = 24 * 60 * 60 * 1000;
  var _registry = {}; // id -> { series, opts, hidden: Set<number> }
  var _tipEl = null;

  function _ensureTip() {
    if (_tipEl) return _tipEl;
    _tipEl = document.createElement('div');
    _tipEl.className = 'mx-chart-tip';
    _tipEl.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none;' +
      'background:var(--bg2,#1c1c22);color:var(--text1,#fff);border:1px solid var(--border1,#333);' +
      'border-radius:6px;padding:6px 9px;font-size:11px;font-family:sans-serif;line-height:1.4;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:220px;white-space:nowrap';
    document.body.appendChild(_tipEl);
    return _tipEl;
  }

  function _fmtDateLabel(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function _esc(s) {
    return (window.MX && window.MX.esc) ? window.MX.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showPoint(evt, id, seriesIdx, i) {
    var entry = _registry[id];
    if (!entry) return;
    var s = entry.series[seriesIdx];
    if (!s) return;
    var v = s.vals[i];
    if (typeof v !== 'number') return;
    var unit = entry.opts.unit || '°C';
    var dateTxt = (s.ts && s.ts[i] != null) ? _fmtDateLabel(s.ts[i]) : (s.labels && s.labels[i] ? s.labels[i] : '');
    var tip = _ensureTip();
    tip.innerHTML = '<div style="font-weight:600;margin-bottom:2px">' + _esc(s.label) + '</div>' +
      (dateTxt ? '<div>' + _esc(dateTxt) + '</div>' : '') +
      '<div>' + v.toFixed(1) + ' ' + _esc(unit) + '</div>';
    tip.style.display = 'block';
    var x = (evt.touches && evt.touches[0]) ? evt.touches[0].clientX : evt.clientX;
    var y = (evt.touches && evt.touches[0]) ? evt.touches[0].clientY : evt.clientY;
    var pad = 14;
    tip.style.left = Math.min(x + pad, window.innerWidth - 230) + 'px';
    tip.style.top = Math.max(y - 40, 4) + 'px';
  }

  function hidePoint() {
    if (_tipEl) _tipEl.style.display = 'none';
  }

  function toggleSeries(id, idx) {
    var entry = _registry[id];
    if (!entry) return;
    if (entry.hidden.has(idx)) entry.hidden.delete(idx); else entry.hidden.add(idx);
    var container = document.getElementById(id);
    if (container) container.outerHTML = _renderChart(id);
  }

  // ── Construction des segments d'une série : une valeur manquante ou un
  // écart temporel > gapMs coupe le tracé, jamais de pont artificiel. ──
  function _buildSegments(vals, ts, gapMs, px, py) {
    var segs = [], cur = [];
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (typeof v !== 'number') {
        if (cur.length) { segs.push(cur); cur = []; }
        continue;
      }
      if (cur.length && gapMs && ts && ts[i] != null) {
        var prevI = cur[cur.length - 1].i;
        if (ts[prevI] != null && Math.abs(ts[i] - ts[prevI]) > gapMs) {
          segs.push(cur); cur = [];
        }
      }
      cur.push({ i: i, x: px(i), y: py(v) });
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  function _pathFromSegment(pts, smooth) {
    if (pts.length < 2) return '';
    if (!smooth) {
      var d = 'M ' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
      for (var i = 1; i < pts.length; i++) d += ' L ' + pts[i].x.toFixed(1) + ',' + pts[i].y.toFixed(1);
      return d;
    }
    // Lissage optionnel : point de contrôle au milieu de chaque segment
    // (même principe que consommations.js:_bezierLineSVG), appliqué
    // uniquement À L'INTÉRIEUR d'un segment déjà coupé par _buildSegments —
    // jamais de lissage qui traverserait une rupture de données.
    var dd = 'M ' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
    for (var j = 1; j < pts.length; j++) {
      var p0 = pts[j - 1], p1 = pts[j];
      var cpx = (p0.x + p1.x) / 2;
      dd += ' C ' + cpx.toFixed(1) + ',' + p0.y.toFixed(1) + ' ' + cpx.toFixed(1) + ',' + p1.y.toFixed(1) + ' ' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1);
    }
    return dd;
  }

  function _renderChart(id) {
    var entry = _registry[id];
    var series = entry.series, opts = entry.opts, hidden = entry.hidden;
    var H = opts.height || 160, W = opts.width || 600;
    var PADt = 10, PADb = 22, PADl = 30, PADr = 8;
    var cW = W - PADl - PADr, cH = H - PADt - PADb;
    var gapMs = (opts.gapDays == null ? 7 : opts.gapDays) * DAY_MS;
    var smooth = !!opts.smooth;
    var minPoints = opts.minPoints || 2;

    var visible = series.filter(function (s, idx) { return !hidden.has(idx); });
    var allVals = [];
    visible.forEach(function (s) { (s.vals || []).forEach(function (v) { if (typeof v === 'number') allVals.push(v); }); });

    if (!allVals.length) {
      var reason = opts.insufficientReason || ('Historique insuffisant : 0 relevé disponible, ' + minPoints + ' requis au minimum.');
      return '<div id="' + id + '">' + _legendHtml(id, series, hidden) +
        '<div class="ctavc-empty-inline">' + _esc(reason) + '</div></div>';
    }
    if (allVals.length < minPoints) {
      var reason2 = opts.insufficientReason || ('Historique insuffisant : ' + allVals.length + ' relevé(s) disponible(s), ' + minPoints + ' requis au minimum.');
      return '<div id="' + id + '">' + _legendHtml(id, series, hidden) +
        '<div class="ctavc-empty-inline">' + _esc(reason2) + '</div></div>';
    }

    var N = Math.max.apply(null, series.map(function (s) { return s.vals.length; }).concat([2]));
    var minV = Math.min.apply(null, allVals), maxV = Math.max.apply(null, allVals);
    var amp = maxV - minV;
    if (amp < 1) { var mid = (minV + maxV) / 2; minV = mid - 0.5; maxV = mid + 0.5; amp = 1; }
    var margin = amp * 0.1;
    minV -= margin; maxV += margin;

    var px = function (i) { return PADl + (i / Math.max(N - 1, 1)) * cW; };
    var py = function (v) { return PADt + cH - ((v - minV) / (maxV - minV)) * cH; };

    var grid = '';
    for (var g = 0; g <= 3; g++) {
      var y = PADt + (g / 3) * cH;
      var v = maxV - (g / 3) * (maxV - minV);
      grid += '<line x1="' + PADl + '" y1="' + y.toFixed(1) + '" x2="' + (W - PADr) + '" y2="' + y.toFixed(1) + '" stroke="var(--border1)" stroke-width="1"/>' +
        '<text x="2" y="' + (y + 3).toFixed(1) + '" fill="var(--text3)" font-size="8" font-family="monospace">' + v.toFixed(1) + '</text>';
    }

    var refLabels = (series[0] && series[0].labels) || [];
    var xlbls = '';
    var step = N <= 8 ? 1 : Math.ceil(N / 8);
    refLabels.forEach(function (lb, i) {
      if (i % step !== 0 && i !== N - 1) return;
      xlbls += '<text x="' + px(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" fill="var(--text3)" font-size="8" font-family="sans-serif">' + _esc(lb) + '</text>';
    });

    var lines = '', points = '';
    series.forEach(function (s, sIdx) {
      if (hidden.has(sIdx)) return;
      var segs = _buildSegments(s.vals, s.ts, gapMs, px, py);
      segs.forEach(function (seg) {
        if (seg.length >= 2) {
          lines += '<path d="' + _pathFromSegment(seg, smooth) + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        seg.forEach(function (p) {
          points += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.5" fill="' + s.color + '"' +
            ' onmouseenter="MX.Charts._showPoint(event,\'' + id + '\',' + sIdx + ',' + p.i + ')"' +
            ' onmouseleave="MX.Charts._hidePoint()"' +
            ' ontouchstart="MX.Charts._showPoint(event,\'' + id + '\',' + sIdx + ',' + p.i + ')"' +
            '/>';
          // Zone de survol/tap plus large, invisible, même gestionnaires.
          points += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="9" fill="transparent"' +
            ' onmouseenter="MX.Charts._showPoint(event,\'' + id + '\',' + sIdx + ',' + p.i + ')"' +
            ' onmouseleave="MX.Charts._hidePoint()"' +
            ' ontouchstart="MX.Charts._showPoint(event,\'' + id + '\',' + sIdx + ',' + p.i + ')"' +
            '/>';
        });
      });
    });

    var svg = '<div class="ra-svg-wrap"><svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="display:block;overflow:visible" preserveAspectRatio="xMidYMid meet">' +
      grid + lines + points + xlbls + '</svg></div>';

    return '<div id="' + id + '">' + svg + _legendHtml(id, series, hidden) + '</div>';
  }

  function _legendHtml(id, series, hidden) {
    return '<div class="ctavc-chart-legend">' + series.map(function (s, idx) {
      var off = hidden.has(idx);
      return '<span class="ctavc-chart-legend-item' + (off ? ' ctavc-chart-legend-item--off' : '') +
        '" style="cursor:pointer' + (off ? ';opacity:.4' : '') + '" onclick="MX.Charts._toggleSeries(\'' + id + '\',' + idx + ')" title="' +
        (off ? 'Afficher la série' : 'Masquer la série') + '">' +
        '<span class="ctavc-chart-legend-dot" style="background:' + s.color + '"></span>' + _esc(s.label) + '</span>';
    }).join('') + '</div>';
  }

  // ── API publique ──
  // series: [{ label, color, vals:(number|null)[], labels:string[], ts?:(number|null)[] }]
  // opts: { id (requis, identifiant DOM unique et stable pour cette instance
  //   de graphique — nécessaire pour que la légende cliquable puisse
  //   retrouver/re-rendre CE graphique précis), height, width, unit,
  //   gapDays (défaut 7), smooth (défaut false), minPoints (défaut 2),
  //   insufficientReason (texte personnalisé si données insuffisantes) }
  function lineChart(series, opts) {
    opts = opts || {};
    if (!opts.id) throw new Error('MX.Charts.lineChart: opts.id est requis (identifiant DOM stable pour ce graphique).');
    var existing = _registry[opts.id];
    _registry[opts.id] = { series: series, opts: opts, hidden: existing ? existing.hidden : new Set() };
    return _renderChart(opts.id);
  }

  window.MX = window.MX || {};
  window.MX.Charts = {
    lineChart: lineChart,
    _showPoint: showPoint,
    _hidePoint: hidePoint,
    _toggleSeries: toggleSeries,
  };
})();
