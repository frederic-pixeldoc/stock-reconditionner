/* PixelDoc stock : calculs et sauvegardes en fonctions pures (sans DOM, sans localStorage).
   Chargé par index.html (global StockCore) et testé avec `npm test` (node:test).

   Règles de marge alignées sur le simulateur de prix (simulateur-de-prix.netlify.app) :
     coût total = achat + pièces + octroi de mer (% des pièces) + main-d'œuvre (heures × taux)
     marge      = prix de vente − coût total
     ROI (%)    = marge / coût total × 100, arrondi
   TVA : le simulateur n'en applique aucune (tous les montants sont pris tels quels, sans
   conversion HT/TTC) ; l'outil de stock fait donc de même. */
(function (root) {
  'use strict';

  const STATUTS = ['stock', 'reserve', 'vendu', 'panne'];
  const STATUT_LABEL = { stock: 'En stock', reserve: 'Réservé', vendu: 'Vendu', panne: 'En panne' };
  const SEUIL_IMMOBILISE_JOURS = 60;
  const MS_JOUR = 86400000;

  /* Nombre ≥ 0 ou null si vide / invalide (le champ « 0 » reste valide). */
  function nombre(v) {
    if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const nombreOuZero = v => nombre(v) ?? 0;

  /* ── Marge (mêmes règles que le simulateur) ───────────── */
  function coutTotal(pc) {
    const achat = nombre(pc.prixAchat);
    if (achat === null) return null;
    const pieces = nombreOuZero(pc.pieces);
    return achat + pieces + pieces * nombreOuZero(pc.octroi) / 100
      + nombreOuZero(pc.heures) * nombreOuZero(pc.taux);
  }

  /* null si prix d'achat ou de vente non renseigné : ni 0 ni valeur inventée. */
  function marge(pc) {
    const vente = nombre(pc.prixVente);
    const cout = coutTotal(pc);
    return vente === null || cout === null ? null : vente - cout;
  }

  function roi(pc) {
    const m = marge(pc), cout = coutTotal(pc);
    return m === null || !(cout > 0) ? null : Math.round(m / cout * 100);
  }

  /* ── Dates (AAAA-MM-JJ, en jours calendaires : insensible aux fuseaux et à l'heure d'été) ── */
  function jourUTC(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(t);
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null; // refuse le 31/02
  }
  function aujourdhui(now) {
    const d = now instanceof Date ? now : new Date(now ?? Date.now());
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function joursEntre(debut, fin) {
    const a = jourUTC(debut), b = typeof fin === 'number' ? fin : jourUTC(fin);
    return a === null || b === null ? null : Math.round((b - a) / MS_JOUR);
  }

  /* Durée en stock : entrée → vente pour un PC vendu, entrée → aujourd'hui sinon. */
  function dureeStock(pc, now) {
    const fin = pc.statut === 'vendu' ? jourUTC(pc.dateVente) : aujourdhui(now);
    const j = joursEntre(pc.dateEntree, fin);
    return j === null || j < 0 ? null : j;
  }

  const moyenne = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  /* ── Tableau de bord ──────────────────────────────────── */
  function statsTableauDeBord(stock, now) {
    const vendus = stock.filter(p => p.statut === 'vendu');
    const invendus = stock.filter(p => p.statut !== 'vendu');
    const margesVendus = vendus.map(marge).filter(m => m !== null);
    const margesPotentielles = invendus.filter(p => p.statut !== 'panne').map(marge).filter(m => m !== null);
    const durees = vendus.map(p => dureeStock(p, now)).filter(d => d !== null);
    const immobilises = invendus
      .map(p => ({ pc: p, jours: dureeStock(p, now) }))
      .filter(x => x.jours !== null && x.jours > SEUIL_IMMOBILISE_JOURS)
      .sort((a, b) => b.jours - a.jours);
    return {
      margeTotale: margesVendus.reduce((s, m) => s + m, 0),
      margeMoyenne: moyenne(margesVendus),
      nbVendusAvecMarge: margesVendus.length,
      nbVendusSansPrix: vendus.length - margesVendus.length,
      margePotentielle: margesPotentielles.reduce((s, m) => s + m, 0),
      dureeMoyenneJours: moyenne(durees),
      immobilises,
    };
  }

  /* ── Nettoyage des fiches (import de fichier non fiable) ── */
  const CHAMPS_TEXTE = ['marque', 'modele', 'cpu', 'ram', 'stockage', 'ecran', 'os', 'etat', 'notes', 'acheteur'];
  const CHAMPS_NOMBRE = ['prixAchat', 'prixVente', 'pieces', 'octroi', 'heures', 'taux'];
  const CHAMPS_DATE = ['dateEntree', 'dateVente'];

  function nettoyerFiche(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const txt = v => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
    const pc = { id: typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '' };
    CHAMPS_TEXTE.forEach(k => { pc[k] = txt(raw[k]); });
    CHAMPS_NOMBRE.forEach(k => { const n = nombre(raw[k]); pc[k] = n === null ? '' : String(raw[k]).trim().replace(',', '.'); });
    CHAMPS_DATE.forEach(k => { pc[k] = jourUTC(raw[k]) === null ? '' : raw[k]; });
    pc.statut = STATUTS.includes(raw.statut) ? raw.statut : 'stock';
    return pc;
  }

  function nettoyerStock(liste) {
    const vus = new Set();
    const stock = [];
    let ignorees = 0;
    liste.forEach((raw, i) => {
      const pc = nettoyerFiche(raw);
      if (!pc || (!pc.marque && !pc.modele)) { ignorees++; return; }
      if (!pc.id || vus.has(pc.id)) pc.id = 'imp' + i.toString(36) + Math.random().toString(36).slice(2, 6);
      vus.add(pc.id);
      stock.push(pc);
    });
    return { stock, ignorees };
  }

  /* ── Sauvegarde JSON ──────────────────────────────────── */
  const CLE_STOCK = 'pixeldoc_stock_v1';

  function creerSauvegarde(stock, now) {
    return {
      _version: 1,
      _date: (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString(),
      _source: 'pixeldoc_stock',
      [CLE_STOCK]: stock,
    };
  }

  /* Accepte le format de sauvegarde ou une simple liste. Retourne { ok, stock, date, ignorees } ou { ok:false, erreur }. */
  function lireSauvegarde(texte) {
    let data;
    try { data = JSON.parse(texte); } catch (e) { return { ok: false, erreur: 'Fichier illisible : ce n\'est pas du JSON valide.' }; }
    const liste = Array.isArray(data) ? data : data && data[CLE_STOCK];
    if (!Array.isArray(liste)) return { ok: false, erreur: 'Fichier invalide ou incompatible avec le stock PixelDoc.' };
    const { stock, ignorees } = nettoyerStock(liste);
    if (liste.length > 0 && stock.length === 0) return { ok: false, erreur: 'Aucune fiche PC exploitable dans ce fichier.' };
    const date = data && !Array.isArray(data) && typeof data._date === 'string' && !isNaN(Date.parse(data._date)) ? data._date : null;
    return { ok: true, stock, date, ignorees };
  }

  /* ── Export CSV (comptabilité) : séparateur « ; », décimale « , », UTF-8 avec BOM ── */
  const decimal = n => (n === null ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
  /* Neutralise l'injection de formule dans Excel/LibreOffice (cellule texte commençant par = + - @). */
  const cellule = v => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };

  const ENTETES_CSV = ['Marque', 'Modèle', 'CPU', 'RAM (Go)', 'Stockage', 'Écran', 'OS', 'État', 'Statut',
    'Date entrée', 'Date vente', 'Acheteur', 'Prix achat', 'Pièces', 'Octroi de mer (%)', 'Main-d\'œuvre',
    'Coût total', 'Prix vente', 'Marge', 'ROI (%)', 'Jours en stock', 'Notes'];

  function genererCSV(stock, now) {
    const lignes = stock.map(p => {
      const mo = nombreOuZero(p.heures) * nombreOuZero(p.taux);
      const brut = [
        p.marque, p.modele, p.cpu, p.ram, p.stockage, p.ecran, p.os, p.etat, STATUT_LABEL[p.statut] || p.statut,
        p.dateEntree, p.dateVente, p.acheteur,
      ].map(cellule);
      const montants = [
        decimal(nombre(p.prixAchat)), decimal(nombre(p.pieces)), decimal(nombre(p.octroi)),
        decimal(nombre(p.heures) === null && nombre(p.taux) === null ? null : mo),
        decimal(coutTotal(p)), decimal(nombre(p.prixVente)), decimal(marge(p)),
        roi(p) === null ? '' : String(roi(p)), String(dureeStock(p, now) ?? ''),
      ];
      return [...brut, ...montants, cellule(p.notes)].join(';');
    });
    return '﻿' + [ENTETES_CSV.map(cellule).join(';'), ...lignes].join('\r\n');
  }

  const api = {
    STATUTS, STATUT_LABEL, SEUIL_IMMOBILISE_JOURS, CLE_STOCK,
    nombre, coutTotal, marge, roi, joursEntre, dureeStock, statsTableauDeBord,
    nettoyerStock, creerSauvegarde, lireSauvegarde, genererCSV,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StockCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
