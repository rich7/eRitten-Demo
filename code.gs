/**
 * RITTENKAART - Apps Script backend
 * ------------------------------------------------------------
 * Dit script hoort bij een Google Sheet met een tabblad "Leden"
 * met kolommen (rij 1 = koppen):
 *   A: Lidnummer | B: Naam | C: Email | D: Token | E: Saldo | F: LaatsteScan | G: AangemaaktOp
 *
 * Een tweede tabblad "Log" wordt automatisch aangemaakt bij de eerste scan
 * en houdt elke scanpoging bij (ook geweigerde). Hoeft niet handmatig
 * aangemaakt te worden.
 *
 * Om te voorkomen dat de camera dezelfde QR meerdere keren snel achter
 * elkaar afschrijft, wordt per lid maar 1 keer per SCAN_COOLDOWN_MINUTEN
 * (standaard 5) een rit afgeschreven; pas dat getal hierboven in de code aan.
 *
 * INSTALLATIE
 * 1. Maak een Google Sheet, noem tabblad exact "Leden", zet de koppen
 *    hierboven in rij 1.
 * 2. Extensies > Apps Script, plak dit bestand erin (vervang de inhoud).
 * 3. Project instellingen > Scripteigenschappen, voeg toe:
 *      ADMIN_PASSWORD    = <jouw admin-wachtwoord>
 *      VERENIGING_NAAM   = <naam van de vereniging>
 * 4. Implementeren > Nieuwe implementatie > Type: Webapp
 *      - Uitvoeren als: Ik (jouw account)
 *      - Toegang: Iedereen
 *    Kopieer de webapp-URL, die vul je in bij het adminpaneel en de scanner-app.
 * 5. Wil je dit voor een tweede vereniging? Maak een kopie van de hele
 *    Sheet ("Bestand > Kopie maken"), dat neemt dit script mee. Zet
 *    daarna eigen Scripteigenschappen en doe een nieuwe implementatie.
 */

const SHEET_NAME = 'Leden';
const LOG_SHEET_NAME = 'Log';
const ADMIN_PASSWORD_PROP = 'ADMIN_PASSWORD';
const VERENIGING_NAAM_PROP = 'VERENIGING_NAAM';
const BERICHT_DUUR_PROP = 'BERICHT_DUUR_SECONDEN';
const LID_APP_URL_PROP = 'LID_APP_URL';
const START_SALDO = 10;
const SCAN_COOLDOWN_MINUTEN = 5;

function doGet(e) {
  if (e.parameter.debug === '1') {
    const props = PropertiesService.getScriptProperties();
    const keys = props.getKeys();
    const real = props.getProperty(ADMIN_PASSWORD_PROP);
    return jsonResponse({
      alleEigenschapNamen: keys,
      ADMIN_PASSWORD_gevonden: real !== null,
      ADMIN_PASSWORD_lengte: real ? real.length : 0,
      ADMIN_PASSWORD_heeft_spatie_rand: real ? (real !== real.trim()) : false,
      VERENIGING_NAAM_gevonden: props.getProperty(VERENIGING_NAAM_PROP) !== null,
      LID_APP_URL_gevonden: props.getProperty(LID_APP_URL_PROP) !== null,
      LID_APP_URL_waarde: props.getProperty(LID_APP_URL_PROP) || '(niet ingesteld)'
    });
  }
  return jsonResponse({ info: 'Rittenkaart API draait. Gebruik ?debug=1 voor diagnose.' });
}

function doPost(e) {
  let result;
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;

    switch (action) {
      case 'scan':
        result = scanLid(params.token);
        break;
      case 'memberStatus':
        result = memberStatus(params.lidnummer, params.email);
        break;
      case 'checkAdminPassword':
        checkAdmin(params.adminPassword);
        result = { ok: true, verenigingNaam: getVerenigingNaam(), berichtDuurSeconden: getBerichtDuur() };
        break;
      case 'setBerichtDuur':
        checkAdmin(params.adminPassword);
        result = setBerichtDuur(params.seconden);
        break;
      case 'addMember':
        checkAdmin(params.adminPassword);
        result = addMember(params.lidnummer, params.naam, params.email);
        break;
      case 'topUp':
        checkAdmin(params.adminPassword);
        result = topUp(params.lidnummer, params.aantal);
        break;
      case 'getMembers':
        checkAdmin(params.adminPassword);
        result = getMembers();
        break;
      default:
        throw new Error('Onbekende actie: ' + action);
    }
    return jsonResponse({ success: true, data: result });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function checkAdmin(pw) {
  const real = PropertiesService.getScriptProperties().getProperty(ADMIN_PASSWORD_PROP);
  if (!real) throw new Error('ADMIN_PASSWORD is niet ingesteld in Scripteigenschappen');
  if (!pw || String(pw).trim() !== String(real).trim()) throw new Error('Ongeldig wachtwoord');
}

function getBerichtDuur() {
  const v = PropertiesService.getScriptProperties().getProperty(BERICHT_DUUR_PROP);
  const n = Number(v);
  return n && n > 0 ? n : 5;
}

function setBerichtDuur(seconden) {
  const n = Number(seconden);
  if (!n || n < 1) throw new Error('Ongeldige duur');
  PropertiesService.getScriptProperties().setProperty(BERICHT_DUUR_PROP, String(n));
  return { berichtDuurSeconden: n };
}

function memberStatus(lidnummer, email) {
  if (!lidnummer || !email) throw new Error('Vul lidnummer en e-mailadres in');
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Onbekend lidnummer of e-mailadres');

  const sheet = getSheet();
  const emailInSheet = String(sheet.getRange(row, 3).getValue()).trim().toLowerCase();
  if (emailInSheet !== String(email).trim().toLowerCase()) {
    throw new Error('Onbekend lidnummer of e-mailadres');
  }

  const naam = sheet.getRange(row, 2).getValue();
  const token = sheet.getRange(row, 4).getValue();
  const saldo = sheet.getRange(row, 5).getValue();
  const laatsteScanRaw = sheet.getRange(row, 6).getValue();
  return {
    naam: naam,
    token: token,
    saldo: saldo,
    laatsteBezoek: laatsteScanRaw ? new Date(laatsteScanRaw).toLocaleString('nl-NL') : 'Nog niet geweest'
  };
}

function getLidAppUrl() {
  return PropertiesService.getScriptProperties().getProperty(LID_APP_URL_PROP) || '';
}

function getVerenigingNaam() {
  return PropertiesService.getScriptProperties().getProperty(VERENIGING_NAAM_PROP) || 'de vereniging';
}

function getSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Tabblad "Leden" niet gevonden');
  return sheet;
}

function findRowByToken(token) {
  const data = getSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) === String(token)) return i + 1;
  }
  return -1;
}

function findRowByLidnummer(lidnummer) {
  const data = getSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(lidnummer)) return i + 1;
  }
  return -1;
}

function scanLid(token) {
  if (!token) throw new Error('Geen QR-code gegevens ontvangen');
  const row = findRowByToken(token);
  if (row === -1) {
    logScan('-', '-', 'Geweigerd - onbekende QR-code', '-');
    throw new Error('Onbekende QR-code');
  }

  const sheet = getSheet();
  const lidnummer = sheet.getRange(row, 1).getValue();
  const naam = sheet.getRange(row, 2).getValue();
  const saldo = Number(sheet.getRange(row, 5).getValue());
  const laatsteScanRaw = sheet.getRange(row, 6).getValue();

  if (laatsteScanRaw) {
    const cooldownMs = SCAN_COOLDOWN_MINUTEN * 60 * 1000;
    const verschilMs = Date.now() - new Date(laatsteScanRaw).getTime();
    if (verschilMs < cooldownMs) {
      const resterendeMin = Math.ceil((cooldownMs - verschilMs) / 60000);
      logScan(lidnummer, naam, 'Geweigerd - te snel opnieuw gescand', saldo);
      return {
        naam: naam,
        saldo: saldo,
        toegestaan: false,
        melding: 'Al ingecheckt, probeer over ' + resterendeMin + ' min opnieuw'
      };
    }
  }

  if (saldo <= 0) {
    logScan(lidnummer, naam, 'Geweigerd - geen ritten meer', saldo);
    return { naam: naam, saldo: saldo, toegestaan: false, melding: 'Geen ritten meer over' };
  }

  const nieuwSaldo = saldo - 1;
  sheet.getRange(row, 5).setValue(nieuwSaldo);
  sheet.getRange(row, 6).setValue(new Date());
  logScan(lidnummer, naam, 'Toegang verleend', nieuwSaldo);
  return { naam: naam, saldo: nieuwSaldo, toegestaan: true, melding: 'Toegang verleend' };
}

function getLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_NAME);
    sheet.appendRow(['Tijdstip', 'Lidnummer', 'Naam', 'Resultaat', 'Saldo na actie']);
  }
  return sheet;
}

function logScan(lidnummer, naam, resultaat, saldo) {
  getLogSheet().appendRow([new Date(), lidnummer, naam, resultaat, saldo]);
}

function addMember(lidnummer, naam, email) {
  if (!lidnummer || !naam || !email) throw new Error('Lidnummer, naam en e-mail zijn verplicht');
  if (findRowByLidnummer(lidnummer) !== -1) throw new Error('Lidnummer bestaat al');

  const token = Utilities.getUuid();
  getSheet().appendRow([lidnummer, naam, email, token, START_SALDO, '', new Date()]);
  stuurQrMail(naam, email, token, lidnummer);
  return { lidnummer: lidnummer, naam: naam, email: email, saldo: START_SALDO };
}

function topUp(lidnummer, aantal) {
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Lid niet gevonden');
  const n = Number(aantal);
  if (!n || n <= 0) throw new Error('Ongeldig aantal ritten');

  const sheet = getSheet();
  const naam = sheet.getRange(row, 2).getValue();
  const email = sheet.getRange(row, 3).getValue();
  const huidig = Number(sheet.getRange(row, 5).getValue());
  const nieuw = huidig + n;
  sheet.getRange(row, 5).setValue(nieuw);
  logScan(lidnummer, naam, 'Opgewaardeerd met ' + n + ' ritten', nieuw);
  stuurOpwaardeerMail(naam, email, n, nieuw);
  return { lidnummer: lidnummer, nieuwSaldo: nieuw };
}

function getMembers() {
  const data = getSheet().getDataRange().getValues();
  const leden = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    leden.push({
      lidnummer: data[i][0],
      naam: data[i][1],
      email: data[i][2],
      saldo: data[i][4],
      laatsteScan: data[i][5] ? new Date(data[i][5]).toLocaleString('nl-NL') : ''
    });
  }
  return leden;
}

function stuurQrMail(naam, email, token, lidnummer) {
  const verenigingNaam = getVerenigingNaam();
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(token);
  const blob = UrlFetchApp.fetch(qrUrl).getBlob().setName('rittenkaart-qr.png');
  const lidAppUrl = getLidAppUrl();

  let html =
    '<p>Beste ' + naam + ',</p>' +
    '<p>Hierbij je persoonlijke rittenkaart voor ' + verenigingNaam + ' (lidnummer ' + lidnummer + '), ' +
    'goed voor ' + START_SALDO + ' ritten.</p>' +
    '<p>Toon onderstaande QR-code bij binnenkomst, dan wordt er automatisch 1 rit afgeschreven.</p>' +
    '<img src="cid:qrcode" width="300" height="300" />' +
    '<p>Bewaar deze e-mail goed &mdash; je hebt de code bij elk bezoek nodig. ' +
    'Bijna op? Vraag bij de administratie om je kaart op te waarderen.</p>';

  if (lidAppUrl) {
    html +=
      '<p>Wil je op elk moment je tegoed en laatste bezoek bekijken? Ga naar ' +
      '<a href="' + lidAppUrl + '">' + lidAppUrl + '</a> en vul je lidnummer en e-mailadres in.</p>';
  }

  MailApp.sendEmail({
    to: email,
    subject: 'Jouw rittenkaart voor ' + verenigingNaam,
    htmlBody: html,
    inlineImages: { qrcode: blob }
  });
}

function stuurOpwaardeerMail(naam, email, aantal, nieuwSaldo) {
  const verenigingNaam = getVerenigingNaam();
  const lidAppUrl = getLidAppUrl();

  let html =
    '<p>Beste ' + naam + ',</p>' +
    '<p>Je rittenkaart is opgewaardeerd met ' + aantal + ' ritten. ' +
    'Je hebt nu in totaal ' + nieuwSaldo + ' ritten over.</p>';

  if (lidAppUrl) {
    html +=
      '<p>Wil je je tegoed op elk moment bekijken? Ga naar ' +
      '<a href="' + lidAppUrl + '">' + lidAppUrl + '</a> en vul je lidnummer en e-mailadres in.</p>';
  }

  html += '<p>Tot ziens bij ' + verenigingNaam + '!</p>';

  MailApp.sendEmail({
    to: email,
    subject: 'Je rittenkaart is opgewaardeerd - ' + verenigingNaam,
    htmlBody: html
  });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
