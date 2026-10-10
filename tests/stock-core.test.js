const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../stock-core.js');

const NOW = new Date(2026, 9, 10, 15, 30); // 10 oct. 2026
const pc = (o = {}) => ({ id: 'x', marque: 'Dell', modele: 'Latitude', statut: 'stock', prixAchat: '', prixVente: '', dateEntree: '', dateVente: '', ...o });

test('marge : cohérente avec le simulateur de prix (pièces, octroi de mer, main-d\'œuvre, pas de TVA)', () => {
  // Simulateur : coutTotal = 50 + 20 + 20×10% + 2×15 = 102 ; marge = 150 − 102 = 48 ; ROI = round(48/102×100) = 47
  const p = pc({ prixAchat: '50', pieces: '20', octroi: '10', heures: '2', taux: '15', prixVente: '150' });
  assert.equal(C.coutTotal(p), 102);
  assert.equal(C.marge(p), 48);
  assert.equal(C.roi(p), 47);
});

test('marge simple : vente − achat, valeurs optionnelles absentes = 0', () => {
  assert.equal(C.marge(pc({ prixAchat: '80', prixVente: '130' })), 50);
  assert.equal(C.marge(pc({ prixAchat: '130', prixVente: '80' })), -50);
  assert.equal(C.marge(pc({ prixAchat: '0', prixVente: '40' })), 40);
});

test('marge : null si un prix manque, jamais une valeur inventée', () => {
  assert.equal(C.marge(pc({ prixAchat: '80' })), null);
  assert.equal(C.marge(pc({ prixVente: '80' })), null);
  assert.equal(C.marge(pc({ prixAchat: 'abc', prixVente: '80' })), null);
  assert.equal(C.marge(pc({ prixAchat: '-5', prixVente: '80' })), null);
  assert.equal(C.roi(pc({ prixAchat: '0', prixVente: '40' })), null);
});

test('marge : accepte la virgule décimale', () => {
  assert.equal(C.marge(pc({ prixAchat: '10,5', prixVente: '20' })), 9.5);
});

test('durée en stock : vendu = entrée→vente, sinon entrée→aujourd\'hui', () => {
  assert.equal(C.dureeStock(pc({ statut: 'vendu', dateEntree: '2026-01-01', dateVente: '2026-01-31' }), NOW), 30);
  assert.equal(C.dureeStock(pc({ dateEntree: '2026-10-01' }), NOW), 9);
  assert.equal(C.dureeStock(pc({ dateEntree: '2026-10-10' }), NOW), 0);
});

test('durée en stock : insensible au changement d\'heure et aux dates invalides', () => {
  assert.equal(C.dureeStock(pc({ statut: 'vendu', dateEntree: '2026-03-28', dateVente: '2026-03-30' }), NOW), 2);
  assert.equal(C.dureeStock(pc({ dateEntree: '2026-02-31' }), NOW), null);
  assert.equal(C.dureeStock(pc({ dateEntree: '' }), NOW), null);
  assert.equal(C.dureeStock(pc({ statut: 'vendu', dateEntree: '2026-05-10', dateVente: '' }), NOW), null);
  assert.equal(C.dureeStock(pc({ statut: 'vendu', dateEntree: '2026-05-10', dateVente: '2026-05-01' }), NOW), null);
});

test('tableau de bord : marge totale, moyenne, durée moyenne', () => {
  const s = C.statsTableauDeBord([
    pc({ statut: 'vendu', prixAchat: '100', prixVente: '150', dateEntree: '2026-01-01', dateVente: '2026-01-11' }),
    pc({ statut: 'vendu', prixAchat: '100', prixVente: '120', dateEntree: '2026-02-01', dateVente: '2026-03-03' }),
    pc({ statut: 'vendu', prixAchat: '90', dateEntree: '2026-02-01', dateVente: '2026-02-03' }), // prix de vente oublié
  ], NOW);
  assert.equal(s.margeTotale, 70);
  assert.equal(s.margeMoyenne, 35);
  assert.equal(s.nbVendusAvecMarge, 2);
  assert.equal(s.nbVendusSansPrix, 1);
  assert.equal(s.dureeMoyenneJours, (10 + 30 + 2) / 3);
});

test('tableau de bord : stock vide', () => {
  const s = C.statsTableauDeBord([], NOW);
  assert.equal(s.margeTotale, 0);
  assert.equal(s.margeMoyenne, null);
  assert.equal(s.dureeMoyenneJours, null);
  assert.deepEqual(s.immobilises, []);
});

test('immobilisés : plus de 60 jours, non vendus, triés du plus ancien', () => {
  const s = C.statsTableauDeBord([
    pc({ id: 'a', dateEntree: '2026-08-11' }),                      // 60 j : pas encore
    pc({ id: 'b', dateEntree: '2026-08-10' }),                      // 61 j
    pc({ id: 'c', statut: 'panne', dateEntree: '2026-01-01' }),
    pc({ id: 'd', statut: 'vendu', dateEntree: '2026-01-01', dateVente: '2026-09-01' }), // vendu : jamais
    pc({ id: 'e', dateEntree: '' }),                                // sans date : ignoré
  ], NOW);
  assert.deepEqual(s.immobilises.map(x => x.pc.id), ['c', 'b']);
  assert.equal(s.immobilises[1].jours, 61);
});

test('marge potentielle : exclut vendus et pannes, ignore les PC sans prix', () => {
  const s = C.statsTableauDeBord([
    pc({ prixAchat: '50', prixVente: '100' }),
    pc({ statut: 'reserve', prixAchat: '60', prixVente: '90' }),
    pc({ prixAchat: '70' }),
    pc({ statut: 'panne', prixAchat: '10', prixVente: '99' }),
  ], NOW);
  assert.equal(s.margePotentielle, 80);
});

test('sauvegarde : aller-retour sans perte', () => {
  const stock = [pc({ id: 'a', prixAchat: '80', prixVente: '130', notes: 'é "quoted"' })];
  const r = C.lireSauvegarde(JSON.stringify(C.creerSauvegarde(stock, NOW)));
  assert.equal(r.ok, true);
  assert.equal(r.stock[0].id, 'a');
  assert.equal(r.stock[0].notes, 'é "quoted"');
  assert.equal(C.marge(r.stock[0]), 50);
  assert.equal(r.date, NOW.toISOString());
});

test('sauvegarde : fichiers invalides rejetés', () => {
  assert.equal(C.lireSauvegarde('pas du json').ok, false);
  assert.equal(C.lireSauvegarde('{"autre":1}').ok, false);
  assert.equal(C.lireSauvegarde('null').ok, false);
  assert.equal(C.lireSauvegarde('[1,2,null]').ok, false);
});

test('sauvegarde : accepte une simple liste, un stock vide, et nettoie les fiches', () => {
  assert.equal(C.lireSauvegarde('[]').ok, true);
  const r = C.lireSauvegarde(JSON.stringify([
    { id: 'a', marque: 'HP', modele: 'Elite', statut: 'bizarre', ram: 16, prixAchat: 'xx', dateEntree: 'hier', cpu: { x: 1 } },
    { id: 'a', marque: 'Acer', modele: 'Aspire' },   // id en double
    'poubelle',
    { notes: 'sans marque ni modèle' },
  ]));
  assert.equal(r.ok, true);
  assert.equal(r.stock.length, 2);
  assert.equal(r.ignorees, 2);
  assert.equal(r.stock[0].statut, 'stock');
  assert.equal(r.stock[0].ram, '16');
  assert.equal(r.stock[0].prixAchat, '');
  assert.equal(r.stock[0].dateEntree, '');
  assert.equal(r.stock[0].cpu, '');
  assert.notEqual(r.stock[0].id, r.stock[1].id);
});

test('CSV : en-têtes, séparateur ;, décimale virgule, BOM', () => {
  const csv = C.genererCSV([
    pc({ marque: 'Dell', modele: 'Lat "5490"', statut: 'vendu', prixAchat: '50', pieces: '20', octroi: '10', heures: '2', taux: '15',
         prixVente: '150', dateEntree: '2026-01-01', dateVente: '2026-01-31', acheteur: 'M. Durand', notes: 'a;b' }),
    pc({ marque: 'HP', modele: 'Elite', prixAchat: '10,5' }),
  ], NOW);
  assert.ok(csv.startsWith('﻿"Marque";"Modèle"'));
  const [, l1, l2] = csv.split('\r\n');
  assert.equal(l1, '"Dell";"Lat ""5490""";"";"";"";"";"";"";"Vendu";"2026-01-01";"2026-01-31";"M. Durand";50;20;10;30;102;150;48;47;30;"a;b"');
  assert.equal(l2, '"HP";"Elite";"";"";"";"";"";"";"En stock";"";"";"";10,5;;;;10,5;;;;;""');
});

test('CSV : neutralise l\'injection de formules', () => {
  const csv = C.genererCSV([pc({ marque: '=HYPERLINK("http://x")', modele: '+1', notes: '@cmd' })], NOW);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(csv.includes(`"'+1"`));
  assert.ok(csv.includes(`"'@cmd"`));
});

test('CSV : stock vide = seulement les en-têtes', () => {
  assert.equal(C.genererCSV([], NOW).split('\r\n').length, 1);
});
