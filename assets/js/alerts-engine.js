(function () {
  const INTERVAL_MS = 5 * 60 * 1000; // evaluate every 5 minutes
  let _timer = null;

  // ── Helpers ──

  function _todayDayId() {
    const dow = new Date().getDay();
    return MX.DAYS[dow === 0 ? 6 : dow - 1].id;
  }

  function _todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function _nowHHMM() {
    const n = new Date();
    return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  }

  function _slotProgress(slot) {
    const dayId = _todayDayId();
    const key   = `${dayId}_${slot}`;
    const tasks = (MX.state.tasks && MX.state.tasks[key]) || [];
    if (!tasks.length) return null;
    const done  = tasks.filter(t => !!(MX.state.checks && MX.state.checks[MX.checkKey(dayId, slot, t.id, MX.checkOwnerId(dayId, slot, t))])).length;
    return Math.round((done / tasks.length) * 100);
  }

  // ── Condition evaluators ──

  const EVALS = {
    time_after(c) {
      return _nowHHMM() >= (c.value || '00:00');
    },
    time_before(c) {
      return _nowHHMM() < (c.value || '23:59');
    },
    checklist_pct_below(c) {
      const pct = _slotProgress(c.slot || 'matin');
      return pct !== null && pct < Number(c.threshold || 50);
    },
    checklist_pct_above(c) {
      const pct = _slotProgress(c.slot || 'matin');
      return pct !== null && pct >= Number(c.threshold || 100);
    },
    tech_overload(c) {
      const dayId  = _todayDayId();
      const thresh = Number(c.threshold || 15);
      const users  = MX.state.users || [];
      return users.some(u => {
        let total = 0;
        ['matin', 'journee', 'soir'].forEach(sl => {
          const tasks = (MX.state.tasks && MX.state.tasks[`${dayId}_${sl}`]) || [];
          total += tasks.filter(t => t.assignedTo === u.name).length;
        });
        return total > thresh;
      });
    },
    tech_idle(c) {
      // A tech scheduled today has zero checked tasks after the given time
      const dayId   = _todayDayId();
      const hhmm    = _nowHHMM();
      const after   = c.value || '11:00';
      if (hhmm < after) return false;
      const slot    = c.slot || 'matin';
      const users   = MX.state.users || [];
      const key     = `${dayId}_${slot}`;
      const tasks   = (MX.state.tasks && MX.state.tasks[key]) || [];
      return users.some(u => {
        const mine    = tasks.filter(t => t.assignedTo === u.name);
        if (!mine.length) return false;
        const checked = mine.filter(t => !!(MX.state.checks && MX.state.checks[MX.checkKey(dayId, slot, t.id, MX.checkOwnerId(dayId, slot, t))])).length;
        return checked === 0;
      });
    },
    missions_unassigned(c) {
      const missions = MX.state.missions || [];
      const cnt = missions.filter(m => !m.assignedTo && m.status !== 'done' && m.status !== 'closed' && m.status !== 'cancelled').length;
      return cnt > Number(c.threshold || 0);
    },
    missions_urgent_pending(c) {
      const missions = MX.state.missions || [];
      const pending  = missions.filter(m => m.priority === 'urgent' && m.status !== 'done' && m.status !== 'closed' && m.status !== 'cancelled');
      const thresh   = Number(c.threshold || 0); // delay in hours
      if (!thresh) return pending.length > 0;
      // Check if any urgent mission is older than threshold hours
      const cutoff = Date.now() - thresh * 3600000;
      return pending.some(m => {
        const ts = m.createdAt?.seconds ? m.createdAt.seconds * 1000 : m.createdAt || 0;
        return ts < cutoff;
      });
    },
    planning_understaffed(c) {
      const slot   = c.slot || 'matin';
      const thresh = Number(c.threshold || 1);
      const today  = _todayStr();
      const entries = MX.state.planningEntries || {};
      const users   = MX.state.users || [];
      const CODES   = slot === 'matin' ? ['1'] : slot === 'journee' ? ['2', '3'] : ['4'];
      const count   = users.filter(u => {
        const e = entries[`${u.id}_${today}`];
        return e && CODES.includes(e.shiftCode);
      }).length;
      return count < thresh;
    },
    planning_no_tech_tomorrow(c) {
      const slot    = c.slot || 'matin';
      const tmr     = new Date(); tmr.setDate(tmr.getDate() + 1);
      const tmrStr  = tmr.toISOString().slice(0, 10);
      const entries = MX.state.planningEntries || {};
      const users   = MX.state.users || [];
      const CODES   = slot === 'matin' ? ['1'] : slot === 'journee' ? ['2', '3'] : ['4'];
      return !users.some(u => {
        const e = entries[`${u.id}_${tmrStr}`];
        return e && CODES.includes(e.shiftCode);
      });
    },
  };

  function _evalRule(rule) {
    const conds = rule.conditions || [];
    if (!conds.length) return false;
    return conds.every(c => {
      const fn = EVALS[c.type];
      return fn ? fn(c) : false;
    });
  }

  // ── Presentation metadata — baked into the alert doc at fire time so the
  // dashboard/notification UI never has to re-look-up a rule that may since
  // have been edited or deleted. ──
  const SLOT_LABELS = { matin: 'Matin', journee: 'Après-midi', soir: 'Soir' };
  function _kindOf(condType) {
    if (!condType) return 'generic';
    if (condType.indexOf('checklist_') === 0) return 'checklist';
    if (condType.indexOf('planning_') === 0)  return 'planning';
    if (condType.indexOf('missions_') === 0)  return 'missions';
    if (condType.indexOf('tech_') === 0)      return 'tech';
    return 'generic';
  }
  function _presentation(rule) {
    const conds = rule.conditions || [];
    const first = conds[0] || {};
    const kind  = _kindOf(first.type);
    const slotCond = conds.find(c => c.slot);
    const location = slotCond ? (SLOT_LABELS[slotCond.slot] || slotCond.slot) : '';
    return { kind, location };
  }

  function _buildMessage(rule) {
    let msg = rule.message || rule.name || 'Alerte déclenchée';
    // Simple interpolation: replace {progress} with actual value
    const slotCond = (rule.conditions || []).find(c => c.slot);
    if (slotCond) {
      const pct = _slotProgress(slotCond.slot);
      if (pct !== null) msg = msg.replace('{progress}', pct);
    }
    return msg;
  }

  function _shouldFire(rule) {
    const today    = _todayStr();
    // One stable doc per rule per day — see createTriggeredAlert().
    const existing = (MX.state.triggeredAlerts || []).find(a => a.ruleId === rule.id && a.dateKey === today);
    if (!existing) return true;
    if (existing.status === 'resolved') return true; // condition cleared then reappeared — new occurrence, fire now
    const cooldown = (rule.cooldownMin || 60) * 60000;
    const ts = existing.ts && existing.ts.seconds ? existing.ts.seconds * 1000 : (existing.ts || 0);
    return (Date.now() - ts) > cooldown;
  }

  // Rule condition no longer true but today's alert for it is still 'active' —
  // mark it resolved so the dashboard/counter stop treating it as ongoing.
  function _resolveIfActive(rule) {
    const today    = _todayStr();
    const existing = (MX.state.triggeredAlerts || []).find(a => a.ruleId === rule.id && a.dateKey === today);
    if (existing && existing.status !== 'resolved') {
      MX.DB.resolveTriggeredAlert(rule.id, today).catch(function(e) {
        console.error('[AlertsEngine] Erreur resolveTriggeredAlert :', e);
      });
    }
  }

  function _fire(rule) {
    const today   = _todayStr();
    const message = _buildMessage(rule);
    const pres    = _presentation(rule);

    MX.DB.createTriggeredAlert({
      ruleId:    rule.id,
      ruleName:  rule.name,
      level:     rule.level || 'warning',
      message,
      kind:      pres.kind,
      location:  pres.location,
      dateKey:   today,
      acknowledged: false,
    }).catch(function(e) {
      console.error('[AlertsEngine] Erreur createTriggeredAlert :', e);
    });

    // Browser notification — routed via MX.Notifs.push for sound/float/Firestore
    if (rule.notifyBrowser) {
      if (window.MX && window.MX.Notifs && window.MX.Notifs.push) {
        window.MX.Notifs.push({
          title:       'Maintix — ' + (rule.name || 'Alerte'),
          description: message,
          type:        'alert',
          level:       rule.level || 'warning',
        });
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('Maintix — ' + (rule.name || 'Alerte'), {
            body: message,
            icon: '/assets/icons/icon-192.png',
            tag:  'mx-alert-' + rule.id,
          });
        } catch (_) {}
      }
    }
  }

  function _check() {
    const rules = MX.state.alertRules || [];
    rules.filter(r => r.active !== false).forEach(rule => {
      if (_evalRule(rule)) {
        if (_shouldFire(rule)) _fire(rule);
      } else {
        _resolveIfActive(rule);
      }
    });
  }

  function start() {
    if (_timer) return;
    // First check after 4 seconds (let state listeners settle)
    setTimeout(_check, 4000);
    _timer = setInterval(_check, INTERVAL_MS);
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  window.MX = window.MX || {};
  window.MX.AlertsEngine = { start, stop, checkNow: _check };
})();
