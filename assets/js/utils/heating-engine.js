(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // MOTEUR DE RECOMMANDATION CHAUFFAGE (v1) — pur, sans Firestore ni DOM,
  // pour rester testable isolément (voir tests/heating_engine_test.js).
  // Reçoit l'état déjà chargé (circuits, relevés, série météo/DJU) et
  // produit des CANDIDATS de recommandation, jamais persistés ici — la
  // page CTA/VC (assets/js/pages/cta-vc.js) décide quoi enregistrer et sous
  // quel statut, conformément à "le technicien reste responsable".
  //
  // RÈGLES DE SÉCURITÉ (volontairement strictes) :
  //  - Ne propose JAMAIS une valeur de consigne chiffrée inventée. Si une
  //    évolution de réglage est suggérée, elle référence uniquement une
  //    valeur DÉJÀ connue et documentée sur le circuit, qualitativement
  //    (augmenter/diminuer), jamais un nouveau chiffre calculé.
  //  - Si le type de régulation ou les réglages actuels ne sont pas
  //    renseignés, AUCUNE recommandation de réglage n'est produite — la
  //    seule sortie possible est "donnees_insuffisantes".
  // ══════════════════════════════════════════════════════════════════════

  var READING_STALE_MS = 48 * 60 * 60 * 1000; // 48h sans relevé = à vérifier
  var TARGET_GAP_WATCH  = 1;   // °C sous la cible → "zone froide à surveiller"
  var TARGET_GAP_URGENT = 2.5; // °C sous la cible → priorité haute
  var DJU_TREND_SIGNIFICANT = 2; // écart moyen DJU (prochains vs passés) jugé significatif

  // ── EXPIRATION DES RECOMMANDATIONS ──
  // Règle de durée UNIQUE et centralisée ici — toute la logique d'expiration
  // (assets/js/pages/cta-vc.js) lit cette seule constante, jamais de délai
  // recopié ailleurs. Une recommandation n'expire QUE si elle est encore
  // "à examiner" (ni acceptée, ni refusée, ni appliquée) : une décision déjà
  // prise par un technicien n'expire jamais, et "appliquée" reste strictement
  // distinct d'"expirée" (deux statuts terminaux différents, jamais confondus).
  var RECO_EXPIRY_DAYS = 14;
  var RECO_EXPIRY_MS = RECO_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  function _tsToMs(ts) {
    if (!ts) return null;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    var d = new Date(ts);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  // isExpired(reco, nowMs) → bool. Ne considère QUE le statut 'a_examiner' —
  // 'acceptee'/'refusee'/'appliquee' sont des décisions humaines définitives,
  // jamais écrasées par une expiration automatique.
  function isExpired(reco, nowMs) {
    if (!reco || reco.status !== 'a_examiner') return false;
    var createdMs = _tsToMs(reco.createdAt);
    if (createdMs === null) return false;
    return (nowMs - createdMs) > RECO_EXPIRY_MS;
  }

  function _latestReadingFor(circuit, readings) {
    var matches = (readings || []).filter(function (r) {
      return r.circuitId === circuit.id;
    });
    if (!matches.length) return null;
    return matches.reduce(function (latest, r) {
      var rt = r.recordedAt && r.recordedAt.toMillis ? r.recordedAt.toMillis() : new Date(r.recordedAt || 0).getTime();
      var lt = latest.recordedAt && latest.recordedAt.toMillis ? latest.recordedAt.toMillis() : new Date(latest.recordedAt || 0).getTime();
      return rt > lt ? r : latest;
    });
  }

  function _readingAgeMs(reading, nowMs) {
    if (!reading) return null;
    var rt = reading.recordedAt && reading.recordedAt.toMillis ? reading.recordedAt.toMillis() : new Date(reading.recordedAt || 0).getTime();
    if (!rt) return null;
    return nowMs - rt;
  }

  function _regulationKnown(circuit) {
    if (!circuit.regulationType) return false;
    if (circuit.regulationType === 'vanne_3v') return typeof circuit.waterSetpoint === 'number' || !!circuit.waterLawCurve;
    if (circuit.regulationType === 'consigne') return !!circuit.setpointType && typeof circuit.setpointValue === 'number';
    if (circuit.regulationType === 'mixte') return typeof circuit.waterSetpoint === 'number' || (!!circuit.setpointType && typeof circuit.setpointValue === 'number');
    return !!circuit.regulationDescription; // 'autre'
  }

  function _currentSettingLabel(circuit) {
    if (circuit.regulationType === 'vanne_3v' && typeof circuit.waterSetpoint === 'number') {
      return 'consigne eau de départ ' + circuit.waterSetpoint + '°C';
    }
    if ((circuit.regulationType === 'consigne' || circuit.regulationType === 'mixte') && typeof circuit.setpointValue === 'number') {
      var unit = circuit.setpointType === 'ambiante' ? '°C ambiant' : circuit.setpointType === 'eau' ? '°C eau' : (circuit.setpointUnit || '');
      return 'consigne ' + circuit.setpointValue + unit;
    }
    return null;
  }

  // evaluateCircuit(circuit, readings, weatherSeries, nowMs, todayStr) → reco[]
  function evaluateCircuit(circuit, readings, weatherSeries, nowMs, todayStr) {
    nowMs = nowMs || Date.now();
    var out = [];
    var missing = [];

    var regulationKnown = _regulationKnown(circuit);
    if (!circuit.regulationType) missing.push('type de régulation');
    else if (!regulationKnown) missing.push('réglage actuel du circuit');

    var reading = _latestReadingFor(circuit, readings);
    var ageMs = _readingAgeMs(reading, nowMs);
    if (!reading) missing.push('relevé de température intérieure');

    var series = (weatherSeries || []).filter(function (d) { return d.dju19 !== null; });
    var past = series.filter(function (d) { return d.kind === 'observed'; });
    var next = series.filter(function (d) { return d.kind === 'forecast'; });
    if (!next.length) missing.push('prévisions météo');

    // Donnée insuffisante pour TOUT conseil de réglage dès que la
    // régulation elle-même n'est pas documentée — on s'arrête là pour ce
    // circuit plutôt que de deviner.
    if (!circuit.regulationType || !regulationKnown) {
      out.push({
        circuitId: circuit.id, action: 'donnees_insuffisantes', priority: 'basse',
        title: 'Données insuffisantes pour recommander un réglage',
        justification: 'Le type de régulation ou les réglages actuels de ce circuit ne sont pas renseignés dans sa fiche.',
        dataUsed: {}, missingData: missing, createdAtLocal: todayStr,
      });
      return out;
    }

    // Relevé absent ou ancien — actionnable (aller relever), distinct de
    // "données insuffisantes" (ce n'est pas la config qui manque, c'est la mesure).
    if (!reading || ageMs > READING_STALE_MS) {
      out.push({
        circuitId: circuit.id, action: 'verifier_releve', priority: 'moyenne',
        title: reading ? 'Relevé de température ancien' : 'Aucun relevé de température intérieure',
        justification: reading
          ? 'Dernier relevé pour ce circuit/cette zone datant de plus de 48h — à renouveler pour fiabiliser les conseils suivants.'
          : 'Aucun relevé de température intérieure n\'a encore été saisi pour ce circuit/cette zone.',
        dataUsed: { lastReadingAt: reading ? reading.recordedAt : null }, missingData: ['relevé récent (< 48h)'], createdAtLocal: todayStr,
      });
    }

    // Zone sous sa cible — seulement si une cible ET un relevé récent existent.
    if (reading && typeof circuit.targetTemp === 'number' && ageMs <= READING_STALE_MS) {
      var gap = circuit.targetTemp - reading.temp;
      if (gap >= TARGET_GAP_WATCH) {
        out.push({
          circuitId: circuit.id, action: 'zone_froide', priority: gap >= TARGET_GAP_URGENT ? 'haute' : 'moyenne',
          title: 'Zone en dessous de sa température cible',
          justification: 'Dernier relevé ' + reading.temp + '°C pour une cible de ' + circuit.targetTemp + '°C (écart ' + gap.toFixed(1) + '°C). Réglage actuel : ' + (_currentSettingLabel(circuit) || 'non chiffré') + '.',
          dataUsed: { reading: reading.temp, target: circuit.targetTemp, currentSetting: _currentSettingLabel(circuit) },
          missingData: [], createdAtLocal: todayStr,
        });
      }
    }

    // Tendance météo — baisse de température extérieure anticipée
    // (DJU en hausse) sur les prochains jours vs les jours passés connus.
    if (past.length && next.length) {
      var avgPast = past.reduce(function (s, d) { return s + d.dju19; }, 0) / past.length;
      var avgNext = next.reduce(function (s, d) { return s + d.dju19; }, 0) / next.length;
      var delta = avgNext - avgPast;
      if (delta >= DJU_TREND_SIGNIFICANT) {
        out.push({
          circuitId: circuit.id, action: 'anticiper_baisse', priority: delta >= DJU_TREND_SIGNIFICANT * 1.5 ? 'haute' : 'moyenne',
          title: 'Anticiper une baisse des températures extérieures',
          justification: 'DJU19 prévisionnel moyen des prochains jours (' + avgNext.toFixed(1) + ') en hausse de ' + delta.toFixed(1) + ' point(s) par rapport aux jours passés observés (' + avgPast.toFixed(1) + '). Réglage actuel : ' + (_currentSettingLabel(circuit) || 'non chiffré') + '.',
          dataUsed: { avgDjuPast: avgPast, avgDjuNext: avgNext, currentSetting: _currentSettingLabel(circuit) },
          missingData: [], createdAtLocal: todayStr,
        });
      } else if (delta <= -DJU_TREND_SIGNIFICANT) {
        out.push({
          circuitId: circuit.id, action: 'reevaluer_redoux', priority: 'basse',
          title: 'Réévaluer le réglage après un redoux',
          justification: 'DJU19 prévisionnel moyen des prochains jours (' + avgNext.toFixed(1) + ') en baisse de ' + Math.abs(delta).toFixed(1) + ' point(s) par rapport aux jours passés observés (' + avgPast.toFixed(1) + '). Réglage actuel : ' + (_currentSettingLabel(circuit) || 'non chiffré') + '.',
          dataUsed: { avgDjuPast: avgPast, avgDjuNext: avgNext, currentSetting: _currentSettingLabel(circuit) },
          missingData: [], createdAtLocal: todayStr,
        });
      }
    }

    // Rien de particulier à signaler : maintien explicite (pas un silence).
    if (!out.length) {
      out.push({
        circuitId: circuit.id, action: 'maintenir', priority: 'basse',
        title: 'Maintenir le réglage actuel',
        justification: 'Aucun écart significatif détecté entre la cible, le dernier relevé et la tendance météo à 7 jours. Réglage actuel : ' + (_currentSettingLabel(circuit) || 'non chiffré') + '.',
        dataUsed: { currentSetting: _currentSettingLabel(circuit) }, missingData: [], createdAtLocal: todayStr,
      });
    }
    return out;
  }

  // evaluateAll(circuits, readings, weatherSeries, nowMs, todayStr) → reco[]
  // Ignore les circuits archivés.
  function evaluateAll(circuits, readings, weatherSeries, nowMs, todayStr) {
    var out = [];
    (circuits || []).forEach(function (c) {
      if (c.archived) return;
      out = out.concat(evaluateCircuit(c, readings, weatherSeries, nowMs, todayStr));
    });
    return out;
  }

  window.MX = window.MX || {};
  window.MX.HeatingEngine = {
    evaluateCircuit: evaluateCircuit, evaluateAll: evaluateAll,
    isExpired: isExpired, RECO_EXPIRY_DAYS: RECO_EXPIRY_DAYS,
  };
})();
