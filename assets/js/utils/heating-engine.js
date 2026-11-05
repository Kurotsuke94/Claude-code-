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

  // buildingsById (6e paramètre, optionnel, rétrocompatible) : map
  // {buildingId: buildingDoc} — CORRECTION 1 (configuration thermique) :
  // un circuit appartenant à un bâtiment mode:'automatique' (loi d'eau ou
  // régulation déjà automatique) ne doit JAMAIS porter de candidat de
  // RÉGLAGE actionnable (zone_froide/anticiper_baisse/reevaluer_redoux —
  // les 3 seuls types qui référencent/suggèrent un changement de réglage).
  // MX continue de les CALCULER (surveillance/détection d'anomalie — voir
  // dataUsed, toujours rempli) mais les marque manualAction:false : c'est
  // CE flag, lu par assets/js/pages/cta-vc.js, qui empêche leur synchro
  // Firestore en 'a_examiner' et masque les boutons Accepter/Refuser —
  // jamais un simple filtrage d'affichage côté client seul. Omis (ancien
  // appelant, anciens tests), aucun circuit n'est traité comme automatique
  // — comportement strictement inchangé.
  function evaluateCircuit(circuit, readings, weatherSeries, nowMs, todayStr, buildingsById) {
    nowMs = nowMs || Date.now();
    var out = [];
    var missing = [];
    var building = (buildingsById && circuit.buildingId) ? buildingsById[circuit.buildingId] : null;
    var isAutoBuilding = !!(building && building.mode === 'automatique');

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
          manualAction: !isAutoBuilding,
          title: 'Zone en dessous de sa température cible',
          justification: (isAutoBuilding ? '[Bâtiment en régulation automatique — information uniquement, aucune action de réglage proposée] ' : '') +
            'Dernier relevé ' + reading.temp + '°C pour une cible de ' + circuit.targetTemp + '°C (écart ' + gap.toFixed(1) + '°C).' +
            (isAutoBuilding ? '' : ' Réglage actuel : ' + (_currentSettingLabel(circuit) || 'non chiffré') + '.'),
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
          manualAction: !isAutoBuilding,
          title: 'Anticiper une baisse des températures extérieures',
          justification: (isAutoBuilding ? '[Bâtiment en régulation automatique — information uniquement, aucune action de réglage proposée] ' : '') +
            'DJU19 prévisionnel moyen des prochains jours (' + avgNext.toFixed(1) + ') en hausse de ' + delta.toFixed(1) + ' point(s) par rapport aux jours passés observés (' + avgPast.toFixed(1) + ').' +
            (isAutoBuilding ? '' : ' Réglage actuel : ' + (_currentSettingLabel(circuit) || 'non chiffré') + '.'),
          dataUsed: { avgDjuPast: avgPast, avgDjuNext: avgNext, currentSetting: _currentSettingLabel(circuit) },
          missingData: [], createdAtLocal: todayStr,
        });
      } else if (delta <= -DJU_TREND_SIGNIFICANT) {
        out.push({
          circuitId: circuit.id, action: 'reevaluer_redoux', priority: 'basse',
          manualAction: !isAutoBuilding,
          title: 'Réévaluer le réglage après un redoux',
          justification: (isAutoBuilding ? '[Bâtiment en régulation automatique — information uniquement, aucune action de réglage proposée] ' : '') +
            'DJU19 prévisionnel moyen des prochains jours (' + avgNext.toFixed(1) + ') en baisse de ' + Math.abs(delta).toFixed(1) + ' point(s) par rapport aux jours passés observés (' + avgPast.toFixed(1) + ').' +
            (isAutoBuilding ? '' : ' Réglage actuel : ' + (_currentSettingLabel(circuit) || 'non chiffré') + '.'),
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

  // evaluateAll(circuits, readings, weatherSeries, nowMs, todayStr, buildingsById) → reco[]
  // Ignore les circuits archivés.
  function evaluateAll(circuits, readings, weatherSeries, nowMs, todayStr, buildingsById) {
    var out = [];
    (circuits || []).forEach(function (c) {
      if (c.archived) return;
      out = out.concat(evaluateCircuit(c, readings, weatherSeries, nowMs, todayStr, buildingsById));
    });
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════
  // MOTEUR QUANTITATIF (v2) — REFONTE CTA/VC + CONFIGURATION THERMIQUE
  // ------------------------------------------------------------------
  // Étend (jamais ne remplace) le moteur v1 ci-dessus : v1 reste tel quel,
  // utilisé pour les circuits/historique déjà en place. v2 est le SEUL
  // moteur autorisé à proposer une valeur chiffrée (température d'eau/de
  // soufflage conseillée), et uniquement sous les conditions de sécurité
  // suivantes, vérifiées ICI (jamais seulement côté UI) :
  //   - N'est JAMAIS calculé pour un circuit dont le BÂTIMENT a
  //     mode:'automatique' (loi d'eau ou régulation déjà automatique —
  //     "MX ne doit jamais toucher la loi d'eau d'un bâtiment automatique").
  //     Le mode est lu depuis buildingsById (CONFIGURATION THERMIQUE,
  //     heating_buildings) — JAMAIS un identifiant codé en dur comme
  //     l'ancien 'batiment_1'. Un circuit sans bâtiment connu/trouvé reçoit
  //     explicitement 'exclu'/'observation', jamais un chiffre par défaut.
  //   - Sans relevé à 2 points récent ET sans tendance météo exploitable :
  //     mode 'observation' — AUCUNE valeur chiffrée n'est inventée à partir
  //     d'une simple prévision.
  //   - VC : la valeur d'EAU proposée ne dépasse JAMAIS 50°C, même si une
  //     configuration locale tentait de relever ce plafond (Math.min
  //     appliqué inconditionnellement — plafond de sécurité, pas un simple
  //     défaut modifiable).
  //   - CTA — CORRECTION 2 : eau de batterie et air de soufflage sont DEUX
  //     grandeurs physiques distinctes, JAMAIS mélangées ou plafonnées
  //     l'une par l'autre (c'était un défaut réel de la version précédente,
  //     qui plafonnait l'eau par la plage de soufflage 18-22°C).
  //       - `proposed.blow` : température de SOUFFLAGE, toujours bornée à
  //         [18°C, 22°C] par défaut, ou à une plage plus étroite si
  //         configurée sur l'installation ou globalement (jamais plus large).
  //       - `proposed.water` : température d'EAU DE BATTERIE, bornée
  //         UNIQUEMENT par les limites techniques propres à l'installation
  //         (circuit.waterTempMin/waterTempMax, Configuration thermique) —
  //         si non configurées, `proposed.water` reste `null` (jamais une
  //         valeur inventée faute de limites connues), signalé en clair.
  // ══════════════════════════════════════════════════════════════════════

  var VC_HARD_CAP = 50;        // °C — plafond de sécurité VC, jamais dépassable
  var CTA_DEFAULT_MIN = 18;    // °C — borne basse CTA par défaut
  var CTA_DEFAULT_MAX = 22;    // °C — borne haute CTA par défaut
  var READING_FRESH_HIGH_MS = 24 * 60 * 60 * 1000; // < 24h → confiance haute possible
  var SENSITIVITY_C_PER_DJU_POINT = 0.5; // °C de correction proposée par point d'écart DJU (documenté, pas un chiffre caché)

  function _latestTwoPointReadingFor(circuitId, readings) {
    var matches = (readings || []).filter(function (r) {
      return r.circuitId === circuitId && r.points && r.points.point1 && r.points.point2;
    });
    if (!matches.length) return null;
    return matches.reduce(function (latest, r) {
      var rt = _tsToMs(r.recordedAt) || 0;
      var lt = _tsToMs(latest.recordedAt) || 0;
      return rt > lt ? r : latest;
    });
  }

  function _avg(list, field) {
    var vals = list.map(function (d) { return d[field]; }).filter(function (v) { return typeof v === 'number'; });
    if (!vals.length) return null;
    return vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
  }

  // clampForCircuit(value, circuit, config) → { value, capped, overshoot, undershoot, capLabel }
  // Applique les bornes de sécurité — jamais contournable par la config pour
  // VC (plafond physique en dur), seulement resserrable pour CTA. `overshoot`
  // (valeur brute nécessaire > borne haute) signale une puissance thermique
  // potentiellement insuffisante — distinct d'`undershoot` (besoin réel sous
  // la borne basse, jamais un problème de puissance). CORRECTION PRIORITAIRE
  // (demande utilisateur) : la valeur RETOURNÉE (`value`) ne dépasse JAMAIS
  // ces bornes, quelle que soit la tendance DJU — c'est la seule valeur que
  // l'appelant (cta-vc.js) a le droit d'afficher comme proposition.
  // Resserre [min,max] avec les bornes GÉNÉRALES de l'installation
  // (circuit.tempMin/tempMax — "Température minimale/maximale autorisée"
  // du formulaire Configuration thermique, point 4 de la demande
  // utilisateur) : ces bornes s'appliquent à TOUTE grandeur chiffrée de
  // l'installation (soufflage, eau de batterie, eau VC), en PLUS des
  // limites spécifiques à chaque grandeur — jamais en remplacement, et
  // jamais pour élargir une plage déjà plus stricte.
  function _intersectGeneralLimits(min, max, circuit) {
    if (typeof circuit.tempMin === 'number' && circuit.tempMin > min) min = circuit.tempMin;
    if (typeof circuit.tempMax === 'number' && circuit.tempMax < max) max = circuit.tempMax;
    return { min: min, max: max };
  }

  function clampForCircuit(value, circuit, config) {
    config = config || {};
    if (circuit.type === 'vc') {
      var vcCap = Math.min(VC_HARD_CAP, (typeof circuit.vcMaxTemp === 'number' ? circuit.vcMaxTemp : VC_HARD_CAP), (typeof config.vcMaxTemp === 'number' ? config.vcMaxTemp : VC_HARD_CAP));
      if (typeof circuit.tempMax === 'number' && circuit.tempMax < vcCap) vcCap = circuit.tempMax;
      var capped = value > vcCap;
      return { value: Math.min(value, vcCap), capped: capped, overshoot: capped, undershoot: false, capLabel: vcCap + '°C (plafond VC)' };
    }
    if (circuit.type === 'cta') {
      var min = typeof circuit.ctaRangeMin === 'number' ? circuit.ctaRangeMin : (typeof config.ctaRangeMin === 'number' ? config.ctaRangeMin : CTA_DEFAULT_MIN);
      var max = typeof circuit.ctaRangeMax === 'number' ? circuit.ctaRangeMax : (typeof config.ctaRangeMax === 'number' ? config.ctaRangeMax : CTA_DEFAULT_MAX);
      var bounds = _intersectGeneralLimits(min, max, circuit);
      min = bounds.min; max = bounds.max;
      var cappedLow = value < min, cappedHigh = value > max;
      return { value: Math.max(min, Math.min(max, value)), capped: cappedLow || cappedHigh, overshoot: cappedHigh, undershoot: cappedLow, capLabel: min + '–' + max + '°C (plage de soufflage CTA)' };
    }
    return { value: value, capped: false, overshoot: false, undershoot: false, capLabel: null };
  }

  function _r1(v) { return Math.round(v * 10) / 10; }

  // Eau de batterie CTA : bornée par les limites propres à l'installation
  // si configurées, SINON par les limites générales définies dans
  // Configuration thermique (config.ctaWaterTempMin/Max — même principe de
  // repli que la plage de soufflage/le plafond VC ci-dessus). Si NI l'une
  // NI l'autre n'existe, renvoie null plutôt que d'inventer une plage par
  // défaut : aucune proposition chiffrée pour cette grandeur tant qu'aucune
  // limite réelle n'a été saisie quelque part.
  function _clampCtaWater(value, circuit, config) {
    config = config || {};
    var hasInstallLimits = typeof circuit.waterTempMin === 'number' && typeof circuit.waterTempMax === 'number';
    var hasGeneralLimits = typeof config.ctaWaterTempMin === 'number' && typeof config.ctaWaterTempMax === 'number';
    var hasOperatingLimits = typeof circuit.tempMin === 'number' && typeof circuit.tempMax === 'number';
    if (!hasInstallLimits && !hasGeneralLimits && !hasOperatingLimits) return null;
    var min, max, sourceLabel;
    if (hasInstallLimits) { min = circuit.waterTempMin; max = circuit.waterTempMax; sourceLabel = 'limites eau batterie de l\'installation'; }
    else if (hasGeneralLimits) { min = config.ctaWaterTempMin; max = config.ctaWaterTempMax; sourceLabel = 'limites eau batterie générales (Configuration thermique)'; }
    else { min = circuit.tempMin; max = circuit.tempMax; sourceLabel = 'température autorisée de l\'installation'; }
    // Resserrement final par les bornes générales de l'installation (jamais
    // un élargissement) — voir _intersectGeneralLimits.
    var bounds = _intersectGeneralLimits(min, max, circuit);
    min = bounds.min; max = bounds.max;
    var cappedLow = value < min, cappedHigh = value > max;
    return { value: Math.max(min, Math.min(max, value)), capped: cappedLow || cappedHigh, overshoot: cappedHigh, undershoot: cappedLow, capLabel: min + '–' + max + '°C (' + sourceLabel + ')' };
  }

  // proposeQuantitative(circuit, readings, weatherSeries, config, nowMs, todayStr, buildingsById)
  //   → { mode: 'exclu'|'observation'|'proposition', ... }
  // Ne persiste rien (comme evaluateCircuit) — l'appelant (cta-vc.js) décide.
  function proposeQuantitative(circuit, readings, weatherSeries, config, nowMs, todayStr, buildingsById) {
    nowMs = nowMs || Date.now();
    config = config || {};

    var building = (buildingsById && circuit.buildingId) ? buildingsById[circuit.buildingId] : null;
    if (!circuit.buildingId) {
      return { circuitId: circuit.id, mode: 'exclu', reason: 'Aucun bâtiment associé à ce circuit — assignez-le à un bâtiment depuis Configuration thermique pour activer les propositions MX.' };
    }
    if (buildingsById && !building) {
      // buildingId renseigné mais résolution impossible (bâtiment supprimé/
      // introuvable) : mode observation par prudence, jamais un chiffre tant
      // que le mode réel (auto/manuel) du bâtiment n'est pas confirmé.
      return { circuitId: circuit.id, mode: 'observation', missingData: ['bâtiment associé introuvable'], justification: 'Le bâtiment associé à ce circuit est introuvable — mode observation par prudence, aucune proposition tant que son mode de fonctionnement n\'est pas confirmé.' };
    }
    if (building && building.mode === 'automatique') {
      return { circuitId: circuit.id, mode: 'exclu', reason: 'Bâtiment "' + (building.name || circuit.buildingId) + '" en régulation automatique — MX ne propose jamais de valeur pour ce bâtiment (surveillance uniquement).' };
    }
    if (circuit.type !== 'cta' && circuit.type !== 'vc') {
      return { circuitId: circuit.id, mode: 'exclu', reason: 'Moteur quantitatif réservé aux circuits CTA et VC.' };
    }

    var reading = _latestTwoPointReadingFor(circuit.id, readings);
    var readingAgeMs = reading ? (nowMs - (_tsToMs(reading.recordedAt) || nowMs)) : null;
    // PASSE DE FIABILISATION (demande utilisateur) — "une donnée ancienne
    // ne peut pas être considérée comme une mesure actuelle" : un relevé
    // plus vieux que READING_STALE_MS (48h, même seuil que le moteur
    // qualitatif v1 ci-dessus) n'est JAMAIS utilisé pour calculer une
    // proposition chiffrée, même avec une confiance "faible" — il est
    // traité comme ABSENT pour ce calcul (mode observation), pas comme une
    // mesure dégradée mais exploitable. Avant cette correction, ce moteur
    // (v2) utilisait silencieusement un relevé de n'importe quel âge et se
    // contentait de baisser la confiance affichée — jamais signalé
    // explicitement comme "trop ancien pour être actuel".
    var readingIsStale = reading !== null && readingAgeMs !== null && readingAgeMs > READING_STALE_MS;
    var series = (weatherSeries || []).filter(function (d) { return d.dju !== null && typeof d.dju === 'number'; });
    var past = series.filter(function (d) { return d.kind === 'observed'; });
    var next = series.filter(function (d) { return d.kind === 'forecast'; });

    var missing = [];
    if (!reading) missing.push('relevé à 2 points récent');
    else if (readingIsStale) missing.push('relevé à 2 points RÉCENT (le dernier date de plus de ' + Math.round(READING_STALE_MS / 3600000) + 'h — trop ancien pour être considéré comme une mesure actuelle)');
    if (!past.length) missing.push('historique météo observé');
    if (!next.length) missing.push('prévisions météo');

    if (!reading || readingIsStale || !past.length || !next.length) {
      return {
        circuitId: circuit.id, mode: 'observation', missingData: missing,
        justification: 'Données insuffisantes pour une proposition chiffrée (' + missing.join(', ') + ') — mode observation, aucune valeur inventée.',
      };
    }

    var avgPast = _avg(past, 'dju');
    var avgNext = _avg(next, 'dju');
    var delta = avgNext - avgPast; // >0 : besoin de chauffe en hausse
    var currentWater = (reading.points.point1.waterTemp + reading.points.point2.waterTemp) / 2;
    var currentBlow = (reading.points.point1.blowTemp + reading.points.point2.blowTemp) / 2;

    // 'faible' n'est plus atteignable à ce stade par construction (un
    // relevé > READING_STALE_MS a déjà provoqué un retour anticipé en mode
    // observation ci-dessus) — conservé par robustesse si ce seuil venait
    // à évoluer indépendamment, jamais supprimé pour "simplifier".
    var confidence;
    if (readingAgeMs !== null && readingAgeMs < READING_FRESH_HIGH_MS && past.length >= 5 && next.length >= 5) confidence = 'haute';
    else if (readingAgeMs !== null && readingAgeMs < READING_STALE_MS) confidence = 'moyenne';
    else confidence = 'faible';

    var dataUsed = { avgDjuPast: avgPast, avgDjuNext: avgNext, deltaDju: _r1(delta), readingAgeMs: readingAgeMs };
    var trendLabel = 'Tendance DJU : ' + avgPast.toFixed(1) + ' → ' + avgNext.toFixed(1) + ' (Δ' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + ').';

    if (circuit.type === 'vc') {
      // VC : une seule grandeur chiffrée (eau), plafond 50°C absolu — logique
      // inchangée par rapport à la version précédente (déjà correcte : l'eau
      // VC n'a jamais été confondue avec l'air).
      var clampVc = clampForCircuit(currentWater + delta * SENSITIVITY_C_PER_DJU_POINT, circuit, config);
      return {
        circuitId: circuit.id, mode: 'proposition', confidence: confidence,
        current: { waterTemp: _r1(currentWater), blowTemp: _r1(currentBlow), point1: reading.points.point1, point2: reading.points.point2, recordedAt: reading.recordedAt },
        proposed: { water: { value: _r1(clampVc.value), capped: clampVc.capped, overshoot: clampVc.overshoot, capLabel: clampVc.capLabel }, blow: null },
        dataUsed: dataUsed,
        justification: 'Eau mesurée ' + _r1(currentWater) + '°C (moyenne Point 1/Point 2). ' + trendLabel + ' Proposition ' +
          _r1(clampVc.value) + '°C' + (clampVc.capped ? ' (plafonnée à ' + clampVc.capLabel + ')' : '') + '.' +
          (clampVc.overshoot ? ' ATTENTION : le besoin calculé dépasse ce plafond — la puissance thermique disponible peut être insuffisante.' : ''),
        createdAtLocal: todayStr,
      };
    }

    // CTA — CORRECTION 2 : deux propositions INDÉPENDANTES, jamais l'une ne
    // plafonne l'autre. Le soufflage est TOUJOURS calculable (plage par
    // défaut 18-22°C toujours disponible) ; l'eau de batterie utilise les
    // limites de l'installation, SINON les limites générales définies dans
    // Configuration thermique (voir _clampCtaWater) ; si ni l'une ni
    // l'autre n'est configurée, aucune proposition chiffrée pour cette
    // grandeur.
    var clampBlow = clampForCircuit(currentBlow + delta * SENSITIVITY_C_PER_DJU_POINT, circuit, config);
    var waterRaw = _clampCtaWater(currentWater + delta * SENSITIVITY_C_PER_DJU_POINT, circuit, config);
    var proposedWater = waterRaw ? { value: _r1(waterRaw.value), capped: waterRaw.capped, overshoot: waterRaw.overshoot, capLabel: waterRaw.capLabel } : null;

    var justification = 'Soufflage mesuré ' + _r1(currentBlow) + '°C (moyenne P1/P2). ' + trendLabel + ' Proposition soufflage ' +
      _r1(clampBlow.value) + '°C' + (clampBlow.capped ? ' (plafonnée à ' + clampBlow.capLabel + ')' : '') + '.' +
      (clampBlow.overshoot ? ' ATTENTION : le besoin calculé dépasse cette plage — la puissance thermique disponible peut être insuffisante.' : '');
    justification += proposedWater
      ? ' Eau batterie mesurée ' + _r1(currentWater) + '°C — proposition ' + proposedWater.value + '°C' + (proposedWater.capped ? ' (plafonnée à ' + waterRaw.capLabel + ')' : '') + '.' +
        (proposedWater.overshoot ? ' ATTENTION : le besoin calculé dépasse cette limite — la puissance thermique disponible peut être insuffisante.' : '')
      : ' Température d\'eau de batterie : limites non configurées (ni pour cette installation, ni en général dans Configuration thermique) — aucune proposition chiffrée pour cette grandeur.';

    return {
      circuitId: circuit.id, mode: 'proposition', confidence: confidence,
      current: { waterTemp: _r1(currentWater), blowTemp: _r1(currentBlow), point1: reading.points.point1, point2: reading.points.point2, recordedAt: reading.recordedAt },
      proposed: { blow: { value: _r1(clampBlow.value), capped: clampBlow.capped, overshoot: clampBlow.overshoot, capLabel: clampBlow.capLabel }, water: proposedWater },
      dataUsed: dataUsed, justification: justification, createdAtLocal: todayStr,
    };
  }

  function proposeAllQuantitative(circuits, readings, weatherSeries, config, nowMs, todayStr, buildingsById) {
    var out = [];
    (circuits || []).forEach(function (c) {
      if (c.archived) return;
      out.push(proposeQuantitative(c, readings, weatherSeries, config, nowMs, todayStr, buildingsById));
    });
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════
  // CONFIGURATION THERMIQUE — courbe moyenne du bâtiment (pièces) +
  // comparaison à la courbe de référence programmée. Pur, sans Firestore,
  // mêmes garanties que le reste du fichier : aucune valeur inventée,
  // jamais d'absence de mesure traitée comme 0°C.
  // ══════════════════════════════════════════════════════════════════════
  var ROOM_READING_DEFAULT_FRESH_HOURS = 24; // "relevé récent" par défaut si non précisé par l'appelant

  function _latestRoomReading(roomId, readings, nowMs, freshMs) {
    var matches = (readings || []).filter(function (r) { return r.roomId === roomId && typeof r.temp === 'number'; });
    if (!matches.length) return null;
    var latest = matches.reduce(function (best, r) {
      var rt = _tsToMs(r.recordedAt) || 0;
      var bt = best ? (_tsToMs(best.recordedAt) || 0) : -1;
      return rt > bt ? r : best;
    }, null);
    var age = nowMs - (_tsToMs(latest.recordedAt) || 0);
    if (age > freshMs) return null; // trop ancien -> exclu, jamais assimilé à 0°C
    return latest;
  }

  // computeBuildingAverageTemp(roomIds, rooms, readings, nowMs, freshnessHours)
  //   → { value: number|null, sampleCount, excludedStale: [], excludedMissing: [] }
  // roomIds = pièces SÉLECTIONNÉES par le Responsable pour ce bâtiment —
  // une pièce non sélectionnée, même avec des relevés, n'influence jamais
  // la moyenne (règle explicite). Une pièce sélectionnée mais inactive
  // (trackedActive:false) ou archivée est également exclue.
  function computeBuildingAverageTemp(roomIds, rooms, readings, nowMs, freshnessHours) {
    nowMs = nowMs || Date.now();
    var freshMs = (typeof freshnessHours === 'number' ? freshnessHours : ROOM_READING_DEFAULT_FRESH_HOURS) * 3600 * 1000;
    var byId = {};
    (rooms || []).forEach(function (r) { byId[r.id] = r; });
    var vals = [], excludedStale = [], excludedMissing = [];
    (roomIds || []).forEach(function (roomId) {
      var room = byId[roomId];
      if (!room || room.archived || room.trackedActive === false) return; // jamais sélectionnable/influent si inactif
      var reading = _latestRoomReading(roomId, readings, nowMs, freshMs);
      if (!reading) {
        var anyReading = (readings || []).some(function (r) { return r.roomId === roomId; });
        (anyReading ? excludedStale : excludedMissing).push(roomId);
        return; // JAMAIS traité comme 0°C — simplement exclu de la moyenne
      }
      vals.push(reading.temp);
    });
    return {
      value: vals.length ? _r1(vals.reduce(function (s, v) { return s + v; }, 0) / vals.length) : null,
      sampleCount: vals.length, excludedStale: excludedStale, excludedMissing: excludedMissing,
    };
  }

  // interpolateCurve(curvePoints, dju) → température attendue (interpolation
  // linéaire entre les 2 points programmés encadrant ce DJU) ou null si DJU
  // hors de la plage couverte par les points programmés (JAMAIS d'extrapolation
  // inventée au-delà des points réellement saisis par le Responsable).
  function interpolateCurve(curvePoints, dju) {
    var pts = (curvePoints || []).filter(function (p) { return typeof p.dju === 'number' && typeof p.expectedIndoorTemp === 'number'; })
      .slice().sort(function (a, b) { return a.dju - b.dju; });
    if (!pts.length || typeof dju !== 'number') return null;
    if (dju <= pts[0].dju) return pts[0].expectedIndoorTemp;
    if (dju >= pts[pts.length - 1].dju) return pts[pts.length - 1].expectedIndoorTemp;
    for (var i = 1; i < pts.length; i++) {
      if (dju <= pts[i].dju) {
        var a = pts[i - 1], b = pts[i];
        var t = (dju - a.dju) / (b.dju - a.dju);
        return _r1(a.expectedIndoorTemp + t * (b.expectedIndoorTemp - a.expectedIndoorTemp));
      }
    }
    return null;
  }

  // PASSE DE FIABILISATION STATISTIQUE (demande utilisateur) — seuils
  // EXPLICITES et DOCUMENTÉS distinguant données suffisantes/partielles/
  // insuffisantes pour l'analyse DJU/température intérieure. En dessous de
  // DJU_ANALYSIS_MIN_PARTIAL échantillons (jours avec à la fois un relevé
  // de pièce ET une donnée météo), AUCUNE conclusion n'est présentée comme
  // fiable, même si un écart brut existe sur les quelques points
  // disponibles — "deux jours de mesures ne doivent jamais produire une
  // recommandation avec une confiance élevée" (consigne explicite). Entre
  // DJU_ANALYSIS_MIN_PARTIAL et DJU_ANALYSIS_MIN_SUFFICIENT, l'analyse est
  // montrée mais qualifiée "partielle" (confiance limitée, jamais
  // présentée comme une alerte forte). À partir de
  // DJU_ANALYSIS_MIN_SUFFICIENT (une petite semaine de relevés), les
  // données sont considérées "suffisantes". Ces seuils sont volontairement
  // bas (ce n'est pas un modèle statistique sophistiqué, juste un calcul
  // de moyenne/écart simple) mais JAMAIS nuls : 1 ou 2 échantillons ne
  // suffisent jamais à eux seuls.
  var DJU_ANALYSIS_MIN_PARTIAL = 3;     // en dessous : "insuffisant" — aucune détection de dégradation retournée
  var DJU_ANALYSIS_MIN_SUFFICIENT = 7;  // à partir de : "suffisant" — en dessous (mais >= MIN_PARTIAL) : "partiel"
  function _dataSufficiency(sampleCount) {
    if (sampleCount < DJU_ANALYSIS_MIN_PARTIAL) return 'insuffisant';
    if (sampleCount < DJU_ANALYSIS_MIN_SUFFICIENT) return 'partiel';
    return 'suffisant';
  }

  // analyzeCurveDeviation(curvePoints, observedSamples, thresholdC)
  // observedSamples = [{dju, actualTemp, date}] (déjà calculés par l'appelant
  // — historique météo + computeBuildingAverageTemp par jour). Compare
  // chaque échantillon à la courbe programmée et identifie, à titre
  // INDICATIF (méthode statistique simple, pas un apprentissage automatique
  // présenté comme tel), le DJU le plus bas à partir duquel l'écart dépasse
  // le seuil — "le bâtiment commence à perdre de la température à partir de
  // ce niveau de DJU". Retourne null si aucun point de référence ou aucun
  // échantillon exploitable (jamais une valeur inventée). `dataSufficiency`
  // qualifie la fiabilité statistique (voir ci-dessus) ; `degradationFromDju`
  // reste TOUJOURS null quand dataSufficiency === 'insuffisant', quel que
  // soit l'écart observé sur les quelques points disponibles.
  function analyzeCurveDeviation(curvePoints, observedSamples, thresholdC) {
    thresholdC = typeof thresholdC === 'number' ? thresholdC : 1;
    var rows = (observedSamples || []).map(function (s) {
      var expected = interpolateCurve(curvePoints, s.dju);
      if (expected === null || typeof s.actualTemp !== 'number') return null;
      return { dju: s.dju, actualTemp: s.actualTemp, expectedTemp: expected, deviation: _r1(s.actualTemp - expected), date: s.date || null };
    }).filter(function (r) { return r; });
    var sufficiency = _dataSufficiency(rows.length);
    if (!rows.length) return { rows: [], degradationFromDju: null, worstDeviation: null, sampleCount: 0, dataSufficiency: sufficiency };
    var belowThreshold = rows.filter(function (r) { return r.deviation <= -thresholdC; }).sort(function (a, b) { return a.dju - b.dju; });
    var worst = rows.reduce(function (w, r) { return (w === null || r.deviation < w.deviation) ? r : w; }, null);
    return {
      rows: rows,
      degradationFromDju: sufficiency === 'insuffisant' ? null : (belowThreshold.length ? belowThreshold[0].dju : null),
      worstDeviation: worst,
      sampleCount: rows.length,
      dataSufficiency: sufficiency,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // COMPARAISON INDIVIDUELLE DES PIÈCES (demande utilisateur, passe de
  // finalisation) — construit une série temporelle JOUR PAR JOUR à partir
  // des SEULS relevés réels d'UNE pièce (jamais une interpolation ou une
  // valeur inventée pour combler un trou) : un jour sans relevé reste
  // `temp: null` dans `points` ET apparaît dans `missingDays`, visible
  // comme un vrai trou plutôt que lissé. `expectedTemp` = la "température
  // cible" configurée sur la pièce (heating_rooms.targetTemp) — comparaison
  // simple et honnête, distincte de la courbe DJU du bâtiment (qui compare
  // la MOYENNE du bâtiment, pas une pièce individuelle).
  // ══════════════════════════════════════════════════════════════════════
  function buildRoomTemperatureSeries(roomId, readings, days, nowMs, targetTemp) {
    days = days || 14;
    nowMs = nowMs || Date.now();
    var byDay = {};
    (readings || []).filter(function (r) { return r.roomId === roomId && typeof r.temp === 'number'; }).forEach(function (r) {
      var ms = _tsToMs(r.recordedAt);
      if (!ms) return;
      var d = new Date(ms);
      var dayStr = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      byDay[dayStr] = byDay[dayStr] || [];
      byDay[dayStr].push(r.temp);
    });
    var points = [], missingDays = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(nowMs - i * 24 * 3600 * 1000);
      var dayStr = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      var vals = byDay[dayStr];
      if (vals && vals.length) {
        points.push({ date: dayStr, temp: _r1(vals.reduce(function (s, v) { return s + v; }, 0) / vals.length) });
      } else {
        points.push({ date: dayStr, temp: null });
        missingDays.push(dayStr);
      }
    }
    var withTemp = points.filter(function (p) { return p.temp !== null; });
    var lastPoint = withTemp.length ? withTemp[withTemp.length - 1] : null;
    var deviation = (lastPoint && typeof targetTemp === 'number') ? _r1(lastPoint.temp - targetTemp) : null;
    return { points: points, missingDays: missingDays, lastPoint: lastPoint, deviation: deviation, sampleCount: withTemp.length };
  }

  // ══════════════════════════════════════════════════════════════════════
  // ANALYSE DJU / TEMPÉRATURE INTÉRIEURE — raccordement complet (demande
  // utilisateur, passe de finalisation). buildBuildingDailyAverageSeries
  // calcule, JOUR PAR JOUR, la moyenne des pièces SÉLECTIONNÉES à partir
  // des SEULS relevés réels de ce jour-là (jamais une interpolation —
  // un jour sans aucun relevé parmi les pièces sélectionnées reste un
  // trou). Le résultat est ensuite apparié au DJU RÉEL du même jour par
  // l'appelant (voir assets/js/pages/heating-config.js:_curveAnalysisHtml,
  // qui dispose de l'historique météo) pour nourrir analyzeCurveDeviation
  // ci-dessus — jamais un DJU inventé pour un jour sans donnée météo.
  // ══════════════════════════════════════════════════════════════════════
  function buildBuildingDailyAverageSeries(roomIds, rooms, readings, days, nowMs) {
    days = days || 14;
    nowMs = nowMs || Date.now();
    var byId = {};
    (rooms || []).forEach(function (r) { byId[r.id] = r; });
    var selected = (roomIds || []).filter(function (id) { var r = byId[id]; return r && !r.archived && r.trackedActive !== false; });
    var byDay = {};
    (readings || []).filter(function (r) { return r.roomId && selected.indexOf(r.roomId) !== -1 && typeof r.temp === 'number'; }).forEach(function (r) {
      var ms = _tsToMs(r.recordedAt);
      if (!ms) return;
      var d = new Date(ms);
      var dayStr = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      byDay[dayStr] = byDay[dayStr] || [];
      byDay[dayStr].push(r.temp);
    });
    var points = [], missingDays = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(nowMs - i * 24 * 3600 * 1000);
      var dayStr = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      var vals = byDay[dayStr];
      if (vals && vals.length) points.push({ date: dayStr, temp: _r1(vals.reduce(function (s, v) { return s + v; }, 0) / vals.length) });
      else { points.push({ date: dayStr, temp: null }); missingDays.push(dayStr); }
    }
    return { points: points, missingDays: missingDays };
  }

  // ══════════════════════════════════════════════════════════════════════
  // INDICATEURS VUE D'ENSEMBLE (REFONTE CTA/VC, Phase 1) — fonction pure,
  // aucune lecture Firestore ici (toutes les listes sont déjà chargées par
  // l'appelant via les listeners existants de cta-vc.js, aucune nouvelle
  // requête). Centralisée ici (plutôt qu'inline dans cta-vc.js) pour que
  // l'onglet Historique & analyse (Phase 3) réutilise EXACTEMENT le même
  // calcul et affiche toujours les mêmes chiffres pour les mêmes données —
  // jamais deux logiques de comptage différentes pour la même notion.
  //
  // Chaque seuil est une constante nommée, documentée, jamais un nombre
  // "magique" recopié ailleurs :
  //  - CIRCUIT_TRACKED_WINDOW_DAYS : un circuit est "suivi" s'il a reçu au
  //    moins un relevé dans cette fenêtre (sinon il est configuré mais pas
  //    activement surveillé).
  //  - CIRCUIT_CHECK_STALE_DAYS : au-delà, une vérification technique du
  //    circuit (lastCheckedAt) est considérée périmée.
  //  - READING_RECENT_DAYS : fenêtre "relevé récent" (tous types confondus,
  //    circuit et pièce).
  //  - READING_STALE_DAYS : au-delà (ou en l'absence totale de relevé), un
  //    circuit suivi est compté comme "relevé ancien ou manquant" — les deux
  //    cas sont comptés ensemble dans l'indicateur mais restent distingués
  //    dans le détail retourné (voir `readingsStaleOrMissing.items[].reason`)
  //    pour un affichage honnête ("il y a N jours" vs "aucun relevé —
  //    relevé nécessaire"), jamais fondus en un seul libellé.
  //
  // Aucune donnée absente n'est jamais transformée en 0 : un compteur sans
  // donnée exploitable vaut 0 PARCE QU'aucun élément ne remplit la
  // condition, jamais parce qu'une valeur manquante a été traitée comme
  // nulle (voir chaque filtre ci-dessous, qui exclut explicitement — jamais
  // ne substitue — une donnée absente).
  // ══════════════════════════════════════════════════════════════════════
  var CIRCUIT_TRACKED_WINDOW_DAYS = 30;
  var CIRCUIT_CHECK_STALE_DAYS = 90;
  var READING_RECENT_DAYS = 7;
  var READING_STALE_DAYS = 14;

  function _daysAgoMs(days) { return days * 24 * 60 * 60 * 1000; }

  // Dernier relevé (le plus récent, toute source confondue) d'UN circuit —
  // jamais un relevé de pièce (roomId) compté par erreur comme relevé de
  // circuit (voir db.js : un relevé porte soit circuitId, soit roomId,
  // jamais les deux ni aucun des deux).
  function _lastCircuitReadingMs(circuitId, readings) {
    var last = null;
    (readings || []).forEach(function (r) {
      if (r.circuitId !== circuitId) return;
      var ms = _tsToMs(r.recordedAt);
      if (ms !== null && (last === null || ms > last)) last = ms;
    });
    return last;
  }

  // Écarts thermiques "anomalie" détectés par bâtiment via le même moteur
  // que l'analyse courbe DJU (voir analyzeCurveDeviation ci-dessus) — exige
  // au moins 2 points de courbe programmés ET un échantillon suffisant
  // (DJU_ANALYSIS_MIN_SUFFICIENT), sinon le bâtiment est simplement exclu du
  // compte (jamais une anomalie affirmée sur des données insuffisantes).
  function _buildingCurveDegradations(buildings, rooms, readings, curvePointsByBuilding, weatherSeries, nowMs) {
    if (!weatherSeries || !weatherSeries.length) return [];
    var out = [];
    (buildings || []).filter(function (b) { return !b.archived; }).forEach(function (b) {
      var points = curvePointsByBuilding[b.id] || [];
      if (points.length < 2) return;
      var trackedRoomIds = (rooms || []).filter(function (r) { return r.buildingId === b.id && r.trackedActive && !r.archived; }).map(function (r) { return r.id; });
      if (!trackedRoomIds.length) return;
      var daily = buildBuildingDailyAverageSeries(trackedRoomIds, rooms, readings, 14, nowMs);
      var samples = [];
      daily.points.forEach(function (p) {
        if (p.temp === null) return;
        var wd = weatherSeries.find(function (d) { return d.date === p.date; });
        if (!wd || typeof wd.dju !== 'number') return;
        samples.push({ dju: wd.dju, actualTemp: p.temp, date: p.date });
      });
      var analysis = analyzeCurveDeviation(points, samples, 1);
      // CORRECTIF (vérification Phase 1) : analyzeCurveDeviation() retourne
      // un degradationFromDju non-null dès la fiabilité 'partiel' (comportement
      // EXISTANT et voulu pour l'affichage détaillé de heating-config.js, qui
      // qualifie alors explicitement le résultat "Confiance limitée" — jamais
      // modifié ici). Mais un chiffre de KPI compact ("Anomalies : N"), sans
      // cette nuance affichée à côté, ne doit JAMAIS compter un résultat
      // 'partiel' comme une anomalie confirmée — seul 'suffisant' (échantillon
      // atteignant réellement DJU_ANALYSIS_MIN_SUFFICIENT) est retenu ici,
      // conformément au plan validé : "compté UNIQUEMENT si l'échantillon
      // atteint DJU_ANALYSIS_MIN_SUFFICIENT". Un bâtiment en zone 'partiel'
      // reste donc exclu du compte, jamais affirmé comme anomalie confirmée.
      if (analysis.dataSufficiency === 'suffisant' && analysis.degradationFromDju !== null) {
        out.push({ buildingId: b.id, degradationFromDju: analysis.degradationFromDju, worstDeviation: analysis.worstDeviation, dataSufficiency: analysis.dataSufficiency });
      }
    });
    return out;
  }

  // computeOverviewIndicators(opts) :
  //  circuits, readings, recommendations, buildings, rooms : listes déjà
  //    chargées (aucune requête ici). curvePointsByBuilding : map buildingId
  //    -> points de courbe (déjà groupés par l'appelant, ou {} si absent).
  //    weatherSeries : série déjà calculée par MX.Dju.buildDailySeries (ou
  //    null tant que non chargée — l'indicateur "anomalies" liées à la
  //    courbe est alors simplement vide, jamais une anomalie inventée).
  //    now : Date.now() par défaut, injectable pour les tests.
  function computeOverviewIndicators(opts) {
    opts = opts || {};
    var circuits = (opts.circuits || []).filter(function (c) { return !c.archived; });
    var readings = opts.readings || [];
    var recommendations = opts.recommendations || [];
    var buildings = opts.buildings || [];
    var rooms = opts.rooms || [];
    var curvePointsByBuilding = opts.curvePointsByBuilding || {};
    var weatherSeries = opts.weatherSeries || null;
    var now = opts.now || Date.now();

    var trackedWindowMs = _daysAgoMs(CIRCUIT_TRACKED_WINDOW_DAYS);
    var checkStaleMs = _daysAgoMs(CIRCUIT_CHECK_STALE_DAYS);
    var recentReadingMs = _daysAgoMs(READING_RECENT_DAYS);
    var readingStaleMs = _daysAgoMs(READING_STALE_DAYS);

    var circuitsConfigured = circuits.filter(function (c) { return c.configStatus === 'configure'; }).length;

    var circuitsTracked = circuits.filter(function (c) {
      var last = _lastCircuitReadingMs(c.id, readings);
      return last !== null && (now - last) <= trackedWindowMs;
    }).length;

    var circuitsToCheck = circuits.filter(function (c) {
      if (c.configStatus === 'a_verifier') return true;
      var checkedMs = _tsToMs(c.lastCheckedAt);
      return checkedMs === null || (now - checkedMs) > checkStaleMs;
    }).length;

    var readingsRecent = readings.filter(function (r) {
      var ms = _tsToMs(r.recordedAt);
      return ms !== null && (now - ms) <= recentReadingMs;
    }).length;

    var staleOrMissingItems = [];
    circuits.forEach(function (c) {
      var last = _lastCircuitReadingMs(c.id, readings);
      if (last === null) { staleOrMissingItems.push({ circuitId: c.id, reason: 'missing', lastReadingMs: null }); return; }
      if ((now - last) > readingStaleMs) staleOrMissingItems.push({ circuitId: c.id, reason: 'stale', lastReadingMs: last });
    });

    // Exclut 'maintenir' (rien à signaler) ET 'donnees_insuffisantes' (le
    // moteur n'a pas pu évaluer, ce n'est pas une recommandation actionnable)
    // — même filtre que la table "Recommandations prioritaires"
    // (_overviewRecoTableHtml dans cta-vc.js), jamais deux définitions
    // différentes de "recommandation active" pour le même chiffre.
    var v1Active = recommendations.filter(function (r) {
      return r.engineVersion !== 'v2' && r.status === 'a_examiner' && r.action !== 'maintenir' && r.action !== 'donnees_insuffisantes';
    });
    var v2NonTerminal = ['proposition_generee', 'validee', 'reglage_effectue', 'consigne_confirmee'];
    var v2Active = recommendations.filter(function (r) { return r.engineVersion === 'v2' && v2NonTerminal.indexOf(r.status) !== -1; });

    var v1HighPriorityActive = v1Active.filter(function (r) { return r.priority === 'haute'; });
    var curveDegradations = _buildingCurveDegradations(buildings, rooms, readings, curvePointsByBuilding, weatherSeries, now);

    return {
      circuitsConfigured: circuitsConfigured,
      circuitsTracked: circuitsTracked,
      circuitsToCheck: circuitsToCheck,
      readingsRecent: readingsRecent,
      readingsStaleOrMissing: { count: staleOrMissingItems.length, items: staleOrMissingItems },
      recommendationsActive: { v1: v1Active.length, v2: v2Active.length, total: v1Active.length + v2Active.length },
      anomalies: {
        count: v1HighPriorityActive.length + curveDegradations.length,
        priorityItems: v1HighPriorityActive.map(function (r) { return { circuitId: r.circuitId, title: r.title }; }),
        curveDegradations: curveDegradations,
      },
    };
  }

  // computeReadingStats(readings) — statistiques simples (moyenne/min/max/
  // nombre/dernière température exploitable), utilisées par l'Historique &
  // analyse (Phase 3). Vue d'ensemble (Phase 1) ne l'appelle PAS : elle
  // calcule séparément une notion différente ("dernier relevé enregistré",
  // via _lastCircuitReadingMs) — voir la distinction ci-dessous, les deux
  // ne sont jamais fusionnées.
  //
  // DEUX NOTIONS DE "DERNIER RELEVÉ", VOLONTAIREMENT DISTINCTES (jamais
  // fusionnées, jamais l'une présentée comme l'autre) :
  //   - `lastRecordedMs` : horodatage du DERNIER RELEVÉ ENREGISTRÉ, quel
  //     qu'il soit — y compris un relevé sans température exploitable
  //     (ex. écriture incomplète). Répond à "ce circuit/cette zone a-t-il
  //     été relevé récemment ?". Calculé sur TOUS les relevés fournis,
  //     indépendamment de `minCount` (une seule saisie suffit à répondre à
  //     cette question).
  //   - `last`/`lastMs` : valeur et horodatage de la DERNIÈRE TEMPÉRATURE
  //     EXPLOITABLE (r.temp, ou moyenne point1/point2 valide). Répond à
  //     "quelle est la dernière valeur de température connue ?". NON gatée
  //     par `minCount` : une seule valeur valide suffit à la connaître (ce
  //     n'est pas une moyenne qui exigerait plusieurs points pour être
  //     significative) — reste renseignée même quand `insufficientData`
  //     est vrai, tant qu'au moins un relevé exploitable existe.
  // N'accepte comme température exploitable que r.temp (nombre) ou une
  // moyenne point1/point2 valide ; tout le reste est ignoré, jamais compté
  // comme 0. `insufficientData` (true en dessous de `minCount`, 2 par
  // défaut) ne gate QUE mean/min/max — jamais une moyenne calculée
  // silencieusement sur un échantillon trop faible pour être significatif.
  function computeReadingStats(readings, minCount) {
    minCount = typeof minCount === 'number' ? minCount : 2;
    var all = readings || [];

    // "Dernier relevé enregistré" — indépendant de l'exploitabilité de la
    // température, indépendant de minCount (une seule saisie, même sans
    // température, répond déjà à "quand a-t-on relevé pour la dernière
    // fois ?"). null uniquement si aucun relevé n'a d'horodatage valide —
    // jamais 0 ni une date inventée.
    var lastRecordedMs = null;
    all.forEach(function (r) {
      var ms = _tsToMs(r.recordedAt);
      if (ms !== null && (lastRecordedMs === null || ms > lastRecordedMs)) lastRecordedMs = ms;
    });

    var withTemp = all.map(function (r) {
      var v = typeof r.temp === 'number' ? r.temp
        : (r.points && r.points.point1 && r.points.point2) ? _r1((r.points.point1.waterTemp + r.points.point2.waterTemp) / 2)
        : null;
      if (v === null) return null;
      return { value: v, ms: _tsToMs(r.recordedAt) };
    }).filter(function (x) { return x; });
    var sorted = withTemp.slice().sort(function (a, b) { return (a.ms || 0) - (b.ms || 0); });

    // "Dernière température exploitable" (last/lastMs) : une SEULE valeur
    // valide suffit à la connaître — ce n'est pas une moyenne, donc jamais
    // gatée par `minCount`, à la différence de mean/min/max ci-dessous qui
    // ont besoin de plusieurs points pour être significatives. null
    // uniquement si aucun relevé n'a de température exploitable du tout.
    var last = sorted.length ? sorted[sorted.length - 1].value : null;
    var lastMs = sorted.length ? sorted[sorted.length - 1].ms : null;

    if (withTemp.length < minCount) {
      return { insufficientData: true, count: withTemp.length, minCount: minCount, mean: null, min: null, max: null, last: last, lastMs: lastMs, lastRecordedMs: lastRecordedMs };
    }
    var sum = 0, min = sorted[0].value, max = sorted[0].value;
    sorted.forEach(function (x) { sum += x.value; if (x.value < min) min = x.value; if (x.value > max) max = x.value; });
    return {
      insufficientData: false,
      count: sorted.length,
      minCount: minCount,
      mean: _r1(sum / sorted.length),
      min: min,
      max: max,
      last: last,
      lastMs: lastMs,
      lastRecordedMs: lastRecordedMs,
    };
  }

  window.MX = window.MX || {};
  window.MX.HeatingEngine = {
    evaluateCircuit: evaluateCircuit, evaluateAll: evaluateAll,
    isExpired: isExpired, RECO_EXPIRY_DAYS: RECO_EXPIRY_DAYS,
    proposeQuantitative: proposeQuantitative, proposeAllQuantitative: proposeAllQuantitative,
    clampForCircuit: clampForCircuit,
    VC_HARD_CAP: VC_HARD_CAP, CTA_DEFAULT_MIN: CTA_DEFAULT_MIN, CTA_DEFAULT_MAX: CTA_DEFAULT_MAX,
    computeBuildingAverageTemp: computeBuildingAverageTemp,
    interpolateCurve: interpolateCurve, analyzeCurveDeviation: analyzeCurveDeviation,
    DJU_ANALYSIS_MIN_PARTIAL: DJU_ANALYSIS_MIN_PARTIAL, DJU_ANALYSIS_MIN_SUFFICIENT: DJU_ANALYSIS_MIN_SUFFICIENT,
    buildRoomTemperatureSeries: buildRoomTemperatureSeries,
    buildBuildingDailyAverageSeries: buildBuildingDailyAverageSeries,
    computeOverviewIndicators: computeOverviewIndicators,
    computeReadingStats: computeReadingStats,
    CIRCUIT_TRACKED_WINDOW_DAYS: CIRCUIT_TRACKED_WINDOW_DAYS,
    CIRCUIT_CHECK_STALE_DAYS: CIRCUIT_CHECK_STALE_DAYS,
    READING_RECENT_DAYS: READING_RECENT_DAYS,
    READING_STALE_DAYS: READING_STALE_DAYS,
  };
})();
