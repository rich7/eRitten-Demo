/**
 * RITTENKAART - Apps Script backend
 * ------------------------------------------------------------
 * Dit script hoort bij een Google Sheet met de volgende tabbladen:
 *
 * "Leden" (rij 1 = koppen):
 *   A: Lidnummer | B: Naam | C: Email | D: Token | E: Saldo | F: LaatsteScan
 *   G: AangemaaktOp | H: Type | I: Vervaldatum | J: Achternaam
 *
 * Kolom H (Type) bevat 'Ritten', 'Abonnement', of - tijdelijk - LEEG.
 * Een leeg Type betekent "onvolledig geregistreerd" (bv. net via import
 * binnengekomen): scannen/opwaarderen/verlengen/mailen wordt dan geweigerd
 * met een duidelijke melding, totdat er via voltooiLid() alsnog een Type
 * gekozen wordt (zelfde als bij een nieuw lid, maar dan voor een lid dat
 * al bestaat en al een token heeft).
 * - Bij 'Ritten' is kolom E (Saldo) van toepassing. Kolom I geeft de
 *   houdbaarheid van de kaart aan (standaard 13 maanden na aanmaken/
 *   opwaarderen, instelbaar) - na die datum werkt de kaart niet meer,
 *   ook al staan er nog ritten op.
 * - Bij 'Abonnement' is kolom E niet van toepassing. Kolom I is de
 *   vervaldatum van het abonnement; toegang wordt verleend zolang die
 *   niet verstreken is - er wordt niets afgeschreven.
 * - Kolom J (Achternaam) is optioneel - blijft leeg tenzij handmatig
 *   ingevuld of via import meegekomen. Kolom B (Naam) wordt gebruikt
 *   zoals ingevuld (geen automatische splitsing in voor-/achternaam).
 *
 * "Beheerders" (automatisch aangemaakt zodra je de eerste beheerder
 * toevoegt via het adminpaneel > tab "Beheerders" - ALLEEN te beheren
 * door de hoofdbeheerder, zie hieronder):
 *   A: Gebruikersnaam | B: Naam | C: WachtwoordHash
 * Een beheerder hoeft geen lid te zijn - los van "Leden".
 *
 * "Scanners" (automatisch aangemaakt zodra je de eerste scanner-gebruiker
 * toevoegt, door elke beheerder te beheren):
 *   A: Lidnummer | B: WachtwoordHash
 * Elke telefoon/scanner logt hiermee apart in. Een scanner-gebruiker moet
 * altijd ook een bestaand lid zijn (Lidnummer moet voorkomen in "Leden").
 *
 * "Log" wordt automatisch aangemaakt bij de eerste scan en houdt elke
 * scanpoging bij (ook geweigerde), plus beheerdersacties (opwaarderen,
 * verlengen, aanmaken, verwijderen, mail versturen) - met wie het deed.
 *
 * TWEE SOORTEN ADMIN-TOEGANG
 * - Hoofdbeheerder: logt in met alleen het wachtwoord uit ADMIN_PASSWORD
 *   (Scripteigenschappen). Dit is de enige die de Beheerders-lijst mag
 *   beheren (toevoegen/verwijderen), en is altijd bruikbaar als vangnet
 *   - kan dus nooit volledig buitengesloten raken.
 * - Beheerder: logt in met gebruikersnaam + eigen wachtwoord (tabblad
 *   "Beheerders"). Heeft verder dezelfde rechten als de hoofdbeheerder
 *   (ledenbeheer, scanner-gebruikers, instellingen), behalve het beheren
 *   van de Beheerders-lijst zelf.
 *
 * WACHTWOORDEN worden als eenrichtings-hash (SHA-256) opgeslagen, nooit
 * als leesbare tekst - dat geldt voor zowel Beheerders als Scanners.
 *
 * E-MAIL is overal een keuze (checkbox in het adminpaneel). Er zit ook
 * een "mail-lock" op: naar hetzelfde lid kan maar 1x per 5 minuten een
 * mail verstuurd worden (voorkomt dubbelklik-spam), via CacheService -
 * geen aparte kolom nodig, deze grens vervalt vanzelf.
 *
 * INGANGSDATUM (bij een nieuw Abonnement) en HOUDBAARHEID (bij Ritten)
 * worden hieronder berekend/toegepast - zie addMember() en topUpRitten().
 *
 * INSTALLATIE
 * 1. Maak een Google Sheet, noem een tabblad exact "Leden", zet de koppen
 *    hierboven in rij 1 (kolom A t/m I). De tabbladen "Beheerders",
 *    "Scanners" en "Log" hoef je niet zelf aan te maken - die verschijnen
 *    vanzelf zodra je de eerste beheerder/scanner-gebruiker toevoegt of
 *    de eerste scan plaatsvindt.
 * 2. Extensies > Apps Script, plak dit bestand erin (vervang de inhoud).
 *    Dit bestand hoef je verder niet te bewerken.
 * 3. Vul de instellingen in via Scripteigenschappen (tandwiel-icoon >
 *    Projectinstellingen > Scripteigenschappen > Scripteigenschap
 *    toevoegen), NIET in deze code:
 *      ADMIN_PASSWORD    = <hoofdbeheerder-wachtwoord>
 *      VERENIGING_NAAM   = <naam van de vereniging>
 *      LID_APP_URL       = <url van lid.html, mag later>
 *    (BERICHT_DUUR_SECONDEN, SCAN_COOLDOWN_MINUTEN en
 *    RITTEN_HOUDBAARHEID_MAANDEN hoef je niet zelf te zetten - die kun
 *    je vanuit het adminpaneel > Instellingen wijzigen.)
 * 4. Implementeren > Nieuwe implementatie > Type: Webapp
 *      - Uitvoeren als: Ik (jouw account)
 *      - Toegang: Iedereen
 *    Kopieer de webapp-URL, die vul je in bij het adminpaneel, de
 *    scanner-app en de ledenapp.
 * 5. Wil je dit voor een tweede vereniging? Maak een kopie van de hele
 *    Sheet ("Bestand > Kopie maken"), dat neemt dit script mee. Zet
 *    daarna eigen Scripteigenschappen en doe een nieuwe implementatie.
 *
 * HOOFDBEHEERDER-WACHTWOORD VERGETEN
 * Pas ADMIN_PASSWORD rechtstreeks aan bij Scripteigenschappen (zie stap 3).
 */

const SHEET_NAME = 'Leden';
const BEHEERDERS_SHEET_NAME = 'Beheerders';
const SCANNERS_SHEET_NAME = 'Scanners';
const LOG_SHEET_NAME = 'Log';
const ADMIN_PASSWORD_PROP = 'ADMIN_PASSWORD';
const VERENIGING_NAAM_PROP = 'VERENIGING_NAAM';
const BERICHT_DUUR_PROP = 'BERICHT_DUUR_SECONDEN';
const SCAN_COOLDOWN_PROP = 'SCAN_COOLDOWN_MINUTEN';
const RITTEN_HOUDBAARHEID_PROP = 'RITTEN_HOUDBAARHEID_MAANDEN';
const LID_APP_URL_PROP = 'LID_APP_URL';
const START_SALDO = 10;
const MAIL_LOCK_SECONDEN = 300; // 5 minuten

const TYPE_RITTEN = 'Ritten';
const TYPE_ABONNEMENT = 'Abonnement';
const DUUR_IN_MAANDEN = { maand: 1, halfjaar: 6, jaar: 12 };

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
    let uitgevoerdDoor;

    switch (action) {
      // ---- Publiek (geen inlog nodig) ----
      case 'scan':
        result = scanLid(params.token, params.scannerLidnummer);
        break;
      case 'zoekLeden':
        result = zoekLeden(params.query);
        break;
      case 'handmatigAfboeken':
        result = handmatigAfboeken(params.lidnummer, params.scannerLidnummer);
        break;
      case 'checkScannerLogin':
        result = checkScannerLogin(params.lidnummer, params.wachtwoord);
        break;
      case 'memberStatus':
        result = memberStatus(params.lidnummer, params.email);
        break;

      // ---- Inloggen (hoofdbeheerder / beheerder) ----
      case 'checkAdminPassword':
        checkAdmin(params.adminPassword);
        result = Object.assign({ ok: true, isHoofdbeheerder: true }, huidigeInstellingen());
        break;
      case 'checkBeheerderLogin':
        result = checkBeheerderLogin(params.beheerderLidnummer, params.beheerderWachtwoord);
        break;

      // ---- Hoofdbeheerder + beheerder (gelijke rechten) ----
      case 'setBerichtDuur':
        checkToegang(params);
        result = setBerichtDuur(params.seconden);
        break;
      case 'setScanCooldown':
        checkToegang(params);
        result = setScanCooldownMinuten(params.minuten);
        break;
      case 'setRittenHoudbaarheid':
        checkToegang(params);
        result = setRittenHoudbaarheidMaanden(params.maanden);
        break;
      case 'addMember':
        uitgevoerdDoor = checkToegang(params);
        result = addMember(params.lidnummer, params.naam, params.email, params.type, params.duur, !!params.stuurMail, params.ingangsdatum, params.achternaam, uitgevoerdDoor);
        break;
      case 'voltooiLid':
        uitgevoerdDoor = checkToegang(params);
        result = voltooiLid(params.lidnummer, params.type, params.duur, !!params.stuurMail, params.ingangsdatum, uitgevoerdDoor);
        break;
      case 'importeerLeden':
        uitgevoerdDoor = checkToegang(params);
        result = importeerLeden(params.rijen, uitgevoerdDoor);
        break;
      case 'vulOntbrekendeTokensAan':
        uitgevoerdDoor = checkToegang(params);
        result = vulOntbrekendeTokensAan(uitgevoerdDoor);
        break;
      case 'importeerAbonnementUpdates':
        uitgevoerdDoor = checkToegang(params);
        result = importeerAbonnementUpdates(params.rijen, uitgevoerdDoor);
        break;
      case 'getMemberInfo':
        checkToegang(params);
        result = getMemberInfo(params.lidnummer);
        break;
      case 'deleteMember':
        uitgevoerdDoor = checkToegang(params);
        result = deleteMember(params.lidnummer, uitgevoerdDoor);
        break;
      case 'topUpRitten':
        uitgevoerdDoor = checkToegang(params);
        result = topUpRitten(params.lidnummer, params.aantal, !!params.stuurMail, uitgevoerdDoor);
        break;
      case 'verlengAbonnement':
        uitgevoerdDoor = checkToegang(params);
        result = verlengAbonnement(params.lidnummer, params.duur, !!params.stuurMail, uitgevoerdDoor);
        break;
      case 'stuurWelkomstMailOpnieuw':
        uitgevoerdDoor = checkToegang(params);
        result = stuurWelkomstMailOpnieuw(params.lidnummer, uitgevoerdDoor);
        break;
      case 'getMembers':
        checkToegang(params);
        result = getMembers();
        break;
      case 'getScannerGebruikers':
        checkToegang(params);
        result = getScannerGebruikers();
        break;
      case 'addScannerGebruiker':
        checkToegang(params);
        result = addScannerGebruiker(params.lidnummer, params.wachtwoord);
        break;
      case 'removeScannerGebruiker':
        checkToegang(params);
        result = removeScannerGebruiker(params.lidnummer);
        break;

      // ---- Alleen hoofdbeheerder ----
      case 'getBeheerders':
        checkAdmin(params.adminPassword);
        result = getBeheerders();
        break;
      case 'addBeheerder':
        checkAdmin(params.adminPassword);
        result = addBeheerder(params.lidnummer, params.wachtwoord);
        break;
      case 'removeBeheerder':
        checkAdmin(params.adminPassword);
        result = removeBeheerder(params.lidnummer);
        break;

      default:
        throw new Error('Onbekende actie: ' + action);
    }
    return jsonResponse({ success: true, data: result });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

/** Hoofdbeheerder-wachtwoord (uit Scripteigenschappen) controleren. */
function checkAdmin(pw) {
  const real = PropertiesService.getScriptProperties().getProperty(ADMIN_PASSWORD_PROP);
  if (!real) throw new Error('ADMIN_PASSWORD is niet ingesteld in Scripteigenschappen');
  if (!pw || String(pw).trim() !== String(real).trim()) throw new Error('Ongeldig wachtwoord');
}

/**
 * Toegang voor acties die zowel hoofdbeheerder als beheerder mogen doen.
 * Geeft een leesbare identiteit terug (voor in het logboek).
 */
function checkToegang(params) {
  if (params.adminPassword) {
    checkAdmin(params.adminPassword);
    return 'Hoofdbeheerder';
  }
  if (params.beheerderLidnummer && params.beheerderWachtwoord) {
    verifieerBeheerder(params.beheerderLidnummer, params.beheerderWachtwoord);
    return params.beheerderLidnummer;
  }
  throw new Error('Niet ingelogd');
}

function huidigeInstellingen() {
  return {
    verenigingNaam: getVerenigingNaam(),
    berichtDuurSeconden: getBerichtDuur(),
    scanCooldownMinuten: getScanCooldownMinuten(),
    rittenHoudbaarheidMaanden: getRittenHoudbaarheidMaanden()
  };
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

function getScanCooldownMinuten() {
  const v = PropertiesService.getScriptProperties().getProperty(SCAN_COOLDOWN_PROP);
  const n = Number(v);
  return n && n > 0 ? n : 5;
}

function setScanCooldownMinuten(minuten) {
  const n = Number(minuten);
  if (!n || n < 0) throw new Error('Ongeldige duur');
  PropertiesService.getScriptProperties().setProperty(SCAN_COOLDOWN_PROP, String(n));
  return { scanCooldownMinuten: n };
}

function getRittenHoudbaarheidMaanden() {
  const v = PropertiesService.getScriptProperties().getProperty(RITTEN_HOUDBAARHEID_PROP);
  const n = Number(v);
  return n && n > 0 ? n : 13;
}

function setRittenHoudbaarheidMaanden(maanden) {
  const n = Number(maanden);
  if (!n || n < 1) throw new Error('Ongeldige duur');
  PropertiesService.getScriptProperties().setProperty(RITTEN_HOUDBAARHEID_PROP, String(n));
  return { rittenHoudbaarheidMaanden: n };
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

function getBeheerdersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BEHEERDERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BEHEERDERS_SHEET_NAME);
    sheet.appendRow(['Lidnummer', 'WachtwoordHash']);
  }
  return sheet;
}

function getScannersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SCANNERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SCANNERS_SHEET_NAME);
    sheet.appendRow(['Lidnummer', 'WachtwoordHash']);
  }
  return sheet;
}

/** Eenrichtings-hash (SHA-256) - niet terug te rekenen naar het wachtwoord. */
function hashWachtwoord(wachtwoord) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(wachtwoord), Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const positief = b < 0 ? b + 256 : b;
    const hex = positief.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/** Zoekt een rij via TextFinder op een specifieke kolom - sneller dan de hele sheet inladen. */
function zoekRijInKolom(sheet, kolomIndex, waarde) {
  const laatsteRij = sheet.getLastRow();
  if (laatsteRij < 2) return -1;
  const bereik = sheet.getRange(2, kolomIndex, laatsteRij - 1, 1);
  const finder = bereik.createTextFinder(String(waarde)).matchEntireCell(true);
  const cel = finder.findNext();
  return cel ? cel.getRow() : -1;
}

function findRowByToken(token) {
  return zoekRijInKolom(getSheet(), 4, token);
}

function findRowByLidnummer(lidnummer) {
  return zoekRijInKolom(getSheet(), 1, lidnummer);
}

function findBeheerderRow(lidnummer) {
  return zoekRijInKolom(getBeheerdersSheet(), 1, lidnummer);
}

function findScannerRow(lidnummer) {
  return zoekRijInKolom(getScannersSheet(), 1, lidnummer);
}

function verifieerBeheerder(lidnummer, wachtwoord) {
  if (!lidnummer || !wachtwoord) throw new Error('Vul lidnummer en wachtwoord in');
  const row = findBeheerderRow(lidnummer);
  if (row === -1) throw new Error('Onbekend lidnummer of wachtwoord');
  const opgeslagenHash = getBeheerdersSheet().getRange(row, 2).getValue();
  if (hashWachtwoord(wachtwoord) !== opgeslagenHash) throw new Error('Onbekend lidnummer of wachtwoord');
  return row;
}

function checkBeheerderLogin(lidnummer, wachtwoord) {
  verifieerBeheerder(lidnummer, wachtwoord);
  let naam = '';
  const lidRow = findRowByLidnummer(lidnummer);
  if (lidRow !== -1) naam = getSheet().getRange(lidRow, 2).getValue();
  return Object.assign(
    { ok: true, isHoofdbeheerder: false, naam: naam, lidnummer: lidnummer },
    huidigeInstellingen()
  );
}

function getBeheerders() {
  const sheet = getBeheerdersSheet();
  const data = sheet.getDataRange().getValues();
  const lijst = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const lidnummer = data[i][0];
    let naam = '';
    const lidRow = findRowByLidnummer(lidnummer);
    if (lidRow !== -1) naam = getSheet().getRange(lidRow, 2).getValue();
    lijst.push({ lidnummer: lidnummer, naam: naam });
  }
  return lijst;
}

function addBeheerder(lidnummer, wachtwoord) {
  if (!lidnummer || !wachtwoord) throw new Error('Lidnummer en wachtwoord zijn verplicht');
  if (String(wachtwoord).length < 4) throw new Error('Kies een wachtwoord van minstens 4 tekens');
  if (findRowByLidnummer(lidnummer) === -1) throw new Error('Dit lidnummer bestaat niet bij de leden - een beheerder moet altijd lid zijn');
  if (findBeheerderRow(lidnummer) !== -1) throw new Error('Deze beheerder bestaat al');
  getBeheerdersSheet().appendRow([lidnummer, hashWachtwoord(wachtwoord)]);
  return { lidnummer: lidnummer };
}

function removeBeheerder(lidnummer) {
  const row = findBeheerderRow(lidnummer);
  if (row === -1) throw new Error('Beheerder niet gevonden');
  getBeheerdersSheet().deleteRow(row);
  return { lidnummer: lidnummer, verwijderd: true };
}

function checkScannerLogin(lidnummer, wachtwoord) {
  if (!lidnummer || !wachtwoord) throw new Error('Vul lidnummer en wachtwoord in');
  const row = findScannerRow(lidnummer);
  if (row === -1) throw new Error('Onbekend lidnummer of wachtwoord');

  const opgeslagenHash = getScannersSheet().getRange(row, 2).getValue();
  if (hashWachtwoord(wachtwoord) !== opgeslagenHash) throw new Error('Onbekend lidnummer of wachtwoord');

  let naam = '';
  const lidRow = findRowByLidnummer(lidnummer);
  if (lidRow !== -1) naam = getSheet().getRange(lidRow, 2).getValue();

  return Object.assign({ ok: true, lidnummer: lidnummer, naam: naam }, huidigeInstellingen());
}

function getScannerGebruikers() {
  const sheet = getScannersSheet();
  const data = sheet.getDataRange().getValues();
  const gebruikers = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const lidnummer = data[i][0];
    let naam = '';
    const lidRow = findRowByLidnummer(lidnummer);
    if (lidRow !== -1) naam = getSheet().getRange(lidRow, 2).getValue();
    gebruikers.push({ lidnummer: lidnummer, naam: naam });
  }
  return gebruikers;
}

function addScannerGebruiker(lidnummer, wachtwoord) {
  if (!lidnummer || !wachtwoord) throw new Error('Lidnummer en wachtwoord zijn verplicht');
  if (String(wachtwoord).length < 4) throw new Error('Kies een wachtwoord van minstens 4 tekens');
  if (findRowByLidnummer(lidnummer) === -1) throw new Error('Dit lidnummer bestaat niet bij de leden - een scanner-gebruiker moet altijd lid zijn');
  if (findScannerRow(lidnummer) !== -1) throw new Error('Deze scanner-gebruiker bestaat al');

  getScannersSheet().appendRow([lidnummer, hashWachtwoord(wachtwoord)]);
  return { lidnummer: lidnummer };
}

function removeScannerGebruiker(lidnummer) {
  const row = findScannerRow(lidnummer);
  if (row === -1) throw new Error('Scanner-gebruiker niet gevonden');
  getScannersSheet().deleteRow(row);
  return { lidnummer: lidnummer, verwijderd: true };
}

/** Telt een aantal maanden op bij een datum. */
function voegMaandenToe(vanafDatum, maanden) {
  const datum = new Date(vanafDatum);
  datum.setMonth(datum.getMonth() + Number(maanden));
  return datum;
}

/** Vervaldatum voor een abonnement, op basis van looptijd ('maand'|'halfjaar'|'jaar'). */
function berekenVervalDatum(vanafDatum, duur) {
  const maanden = DUUR_IN_MAANDEN[duur];
  if (!maanden) throw new Error('Ongeldige looptijd, kies maand, halfjaar of jaar');
  return voegMaandenToe(vanafDatum, maanden);
}

function formatDatum(datum) {
  return datum ? new Date(datum).toLocaleDateString('nl-NL') : '';
}

/** Is een vervaldatum (abonnement óf rittenkaart-houdbaarheid) nog geldig (t/m einde van die dag)? */
function vervaldatumIsGeldig(vervalRaw) {
  if (!vervalRaw) return false;
  const eindeVanDag = new Date(vervalRaw);
  eindeVanDag.setHours(23, 59, 59, 999);
  return eindeVanDag.getTime() >= Date.now();
}

// ---- Mail-lock: max. 1 mail per 5 minuten per lid, ongeacht wie 'm aanvraagt ----

function magMailVersturen(lidnummer) {
  return CacheService.getScriptCache().get('mail_lock_' + lidnummer) === null;
}

function zetMailLock(lidnummer) {
  CacheService.getScriptCache().put('mail_lock_' + lidnummer, '1', MAIL_LOCK_SECONDEN);
}

/** Stuurt een mail alleen als de lock dat toestaat. Geeft terug of de mail echt verstuurd is. */
function verstuurMailMetLock(lidnummer, verstuurFn) {
  if (!magMailVersturen(lidnummer)) return false;
  verstuurFn();
  zetMailLock(lidnummer);
  return true;
}

function scanLid(token, scannerLidnummer) {
  if (!token) throw new Error('Geen QR-code gegevens ontvangen');
  const row = findRowByToken(token);
  if (row === -1) {
    logScan('-', '-', 'Geweigerd - onbekende QR-code', '-', scannerLidnummer);
    throw new Error('Onbekende QR-code');
  }
  return verwerkToegang(row, scannerLidnummer, 'Scan');
}

/** Handmatig afboeken/bevestigen als een lid zijn QR-code vergeten is. Zelfde regels als een gewone scan. */
function handmatigAfboeken(lidnummer, scannerLidnummer) {
  if (!lidnummer) throw new Error('Geen lidnummer opgegeven');
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Lid niet gevonden');
  return verwerkToegang(row, scannerLidnummer, 'Handmatig (QR vergeten)');
}

/** Gedeelde logica voor zowel QR-scan als handmatig afboeken/bevestigen. */
function verwerkToegang(row, scannerLidnummer, methodeLabel) {
  const sheet = getSheet();
  const lidnummer = sheet.getRange(row, 1).getValue();
  const naam = sheet.getRange(row, 2).getValue();
  const type = sheet.getRange(row, 8).getValue();
  const vervalRaw = sheet.getRange(row, 9).getValue();

  if (!type) {
    logScan(lidnummer, naam, methodeLabel + ' - geweigerd (registratie nog niet compleet)', '', scannerLidnummer);
    return {
      naam: naam, type: '', toegestaan: false,
      melding: 'Lidmaatschap nog niet compleet - neem contact op met de administratie'
    };
  }

  if (type === TYPE_ABONNEMENT) {
    if (vervaldatumIsGeldig(vervalRaw)) {
      sheet.getRange(row, 6).setValue(new Date());
      logScan(lidnummer, naam, methodeLabel + ' - toegang verleend (abonnement t/m ' + formatDatum(vervalRaw) + ')', '', scannerLidnummer);
      return {
        naam: naam, type: type, vervalDatum: formatDatum(vervalRaw),
        geldig: true, toegestaan: true, melding: 'Toegang verleend'
      };
    } else {
      logScan(lidnummer, naam, methodeLabel + ' - geweigerd (abonnement verlopen)', '', scannerLidnummer);
      return {
        naam: naam, type: type, vervalDatum: formatDatum(vervalRaw),
        geldig: false, toegestaan: false, melding: 'Abonnement verlopen op ' + formatDatum(vervalRaw)
      };
    }
  }

  // Type Ritten - houdbaarheid gaat vóór (ook als er nog ritten op staan)
  if (vervalRaw && !vervaldatumIsGeldig(vervalRaw)) {
    const saldoNu = Number(sheet.getRange(row, 5).getValue());
    logScan(lidnummer, naam, methodeLabel + ' - geweigerd (rittenkaart verlopen)', saldoNu, scannerLidnummer);
    return {
      naam: naam, type: type, saldo: saldoNu, vervalDatum: formatDatum(vervalRaw),
      geldig: false, toegestaan: false, melding: 'Rittenkaart verlopen op ' + formatDatum(vervalRaw)
    };
  }

  const saldo = Number(sheet.getRange(row, 5).getValue());
  const laatsteScanRaw = sheet.getRange(row, 6).getValue();

  if (laatsteScanRaw) {
    const cooldownMs = getScanCooldownMinuten() * 60 * 1000;
    const verschilMs = Date.now() - new Date(laatsteScanRaw).getTime();
    if (verschilMs < cooldownMs) {
      const resterendeMin = Math.ceil((cooldownMs - verschilMs) / 60000);
      logScan(lidnummer, naam, methodeLabel + ' - geweigerd (te snel opnieuw)', saldo, scannerLidnummer);
      return {
        naam: naam, type: type, saldo: saldo, toegestaan: false,
        melding: 'Al ingecheckt, probeer over ' + resterendeMin + ' min opnieuw'
      };
    }
  }

  if (saldo <= 0) {
    logScan(lidnummer, naam, methodeLabel + ' - geweigerd (geen ritten meer)', saldo, scannerLidnummer);
    return { naam: naam, type: type, saldo: saldo, toegestaan: false, melding: 'Geen ritten meer over' };
  }

  const nieuwSaldo = saldo - 1;
  sheet.getRange(row, 5).setValue(nieuwSaldo);
  sheet.getRange(row, 6).setValue(new Date());
  logScan(lidnummer, naam, methodeLabel + ' - toegang verleend', nieuwSaldo, scannerLidnummer);
  return {
    naam: naam, type: type, saldo: nieuwSaldo, vervalDatum: formatDatum(vervalRaw),
    toegestaan: true, melding: 'Toegang verleend'
  };
}

/** Zoekt leden op (gedeeltelijke) naam of lidnummer, voor de "QR vergeten"-zoekfunctie in de scanner. */
function zoekLeden(query) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];

  const sheet = getSheet();
  const laatsteRij = sheet.getLastRow();
  if (laatsteRij < 2) return [];

  const gevondenRijen = {};
  [1, 2].forEach(function (kolom) {
    const bereik = sheet.getRange(2, kolom, laatsteRij - 1, 1);
    const finder = bereik.createTextFinder(q).matchCase(false).matchEntireCell(false);
    let cel = finder.findNext();
    while (cel) {
      gevondenRijen[cel.getRow()] = true;
      cel = finder.findNext();
    }
  });

  const resultaten = [];
  Object.keys(gevondenRijen).forEach(function (rowStr) {
    const row = Number(rowStr);
    const type = sheet.getRange(row, 8).getValue() || '';
    const vervalRaw = sheet.getRange(row, 9).getValue();
    resultaten.push({
      lidnummer: sheet.getRange(row, 1).getValue(),
      naam: sheet.getRange(row, 2).getValue(),
      type: type,
      saldo: sheet.getRange(row, 5).getValue(),
      vervalDatum: vervalRaw ? formatDatum(vervalRaw) : '',
      geldig: vervalRaw ? vervaldatumIsGeldig(vervalRaw) : null
    });
  });

  return resultaten.slice(0, 20);
}

function getLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_NAME);
    sheet.appendRow(['Tijdstip', 'Lidnummer', 'Naam', 'Resultaat', 'Saldo na actie', 'Uitgevoerd door']);
  }
  return sheet;
}

function logScan(lidnummer, naam, resultaat, saldo, doorWie) {
  getLogSheet().appendRow([new Date(), lidnummer, naam, resultaat, saldo, doorWie || '']);
}

/**
 * ingangsdatum: ISO-datum (yyyy-mm-dd) voor een Abonnement, door de admin-app al
 * bepaald (vandaag / 1 januari / 1 juni / handmatig). Voor Ritten niet van
 * toepassing - houdbaarheid start altijd vanaf vandaag.
 * achternaam is optioneel (kolom J) - mag leeg blijven.
 */
function addMember(lidnummer, naam, email, type, duur, stuurMail, ingangsdatum, achternaam, uitgevoerdDoor) {
  if (!lidnummer || !naam || !email) throw new Error('Lidnummer, naam en e-mail zijn verplicht');
  if (findRowByLidnummer(lidnummer) !== -1) throw new Error('Lidnummer bestaat al');
  if (type !== TYPE_RITTEN && type !== TYPE_ABONNEMENT) throw new Error('Ongeldig type, kies Ritten of Abonnement');

  const token = Utilities.getUuid();
  const achternaamWaarde = achternaam || '';

  if (type === TYPE_RITTEN) {
    const vervalDatum = voegMaandenToe(new Date(), getRittenHoudbaarheidMaanden());
    getSheet().appendRow([lidnummer, naam, email, token, START_SALDO, '', new Date(), TYPE_RITTEN, vervalDatum, achternaamWaarde]);
    logScan(lidnummer, naam, 'Lid aangemaakt (Ritten, houdbaar t/m ' + formatDatum(vervalDatum) + ')', START_SALDO, uitgevoerdDoor);
    let mailVerstuurd = false;
    if (stuurMail) mailVerstuurd = verstuurMailMetLock(lidnummer, function () { stuurWelkomstMailRitten(naam, email, token, lidnummer); });
    return { lidnummer: lidnummer, naam: naam, email: email, type: type, saldo: START_SALDO, vervalDatum: formatDatum(vervalDatum), mailVerstuurd: mailVerstuurd };
  } else {
    const basisDatum = ingangsdatum ? new Date(ingangsdatum) : new Date();
    const vervalDatum = berekenVervalDatum(basisDatum, duur);
    getSheet().appendRow([lidnummer, naam, email, token, '', '', new Date(), TYPE_ABONNEMENT, vervalDatum, achternaamWaarde]);
    logScan(lidnummer, naam, 'Lid aangemaakt (Abonnement, ingangsdatum ' + formatDatum(basisDatum) + ', geldig t/m ' + formatDatum(vervalDatum) + ')', '', uitgevoerdDoor);
    let mailVerstuurd = false;
    if (stuurMail) mailVerstuurd = verstuurMailMetLock(lidnummer, function () { stuurWelkomstMailAbonnement(naam, email, token, lidnummer, vervalDatum); });
    return { lidnummer: lidnummer, naam: naam, email: email, type: type, vervalDatum: formatDatum(vervalDatum), mailVerstuurd: mailVerstuurd };
  }
}

/**
 * Voltooit een lid dat wel al bestaat (bv. via import) maar nog geen Type heeft.
 * Zelfde als addMember, maar dan voor een bestaande rij met een token dat er al is.
 */
function voltooiLid(lidnummer, type, duur, stuurMail, ingangsdatum, uitgevoerdDoor) {
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Lid niet gevonden');
  const sheet = getSheet();
  const huidigType = sheet.getRange(row, 8).getValue();
  if (huidigType) throw new Error('Dit lid heeft al een type (' + huidigType + ')');
  if (type !== TYPE_RITTEN && type !== TYPE_ABONNEMENT) throw new Error('Ongeldig type, kies Ritten of Abonnement');

  const naam = sheet.getRange(row, 2).getValue();
  const email = sheet.getRange(row, 3).getValue();
  const token = sheet.getRange(row, 4).getValue();

  if (type === TYPE_RITTEN) {
    const vervalDatum = voegMaandenToe(new Date(), getRittenHoudbaarheidMaanden());
    sheet.getRange(row, 5).setValue(START_SALDO);
    sheet.getRange(row, 8).setValue(TYPE_RITTEN);
    sheet.getRange(row, 9).setValue(vervalDatum);
    logScan(lidnummer, naam, 'Lid voltooid (Ritten, houdbaar t/m ' + formatDatum(vervalDatum) + ')', START_SALDO, uitgevoerdDoor);
    let mailVerstuurd = false;
    if (stuurMail) mailVerstuurd = verstuurMailMetLock(lidnummer, function () { stuurWelkomstMailRitten(naam, email, token, lidnummer); });
    return { lidnummer: lidnummer, naam: naam, type: type, saldo: START_SALDO, vervalDatum: formatDatum(vervalDatum), mailVerstuurd: mailVerstuurd };
  } else {
    const basisDatum = ingangsdatum ? new Date(ingangsdatum) : new Date();
    const vervalDatum = berekenVervalDatum(basisDatum, duur);
    sheet.getRange(row, 8).setValue(TYPE_ABONNEMENT);
    sheet.getRange(row, 9).setValue(vervalDatum);
    logScan(lidnummer, naam, 'Lid voltooid (Abonnement, ingangsdatum ' + formatDatum(basisDatum) + ', geldig t/m ' + formatDatum(vervalDatum) + ')', '', uitgevoerdDoor);
    let mailVerstuurd = false;
    if (stuurMail) mailVerstuurd = verstuurMailMetLock(lidnummer, function () { stuurWelkomstMailAbonnement(naam, email, token, lidnummer, vervalDatum); });
    return { lidnummer: lidnummer, naam: naam, type: type, vervalDatum: formatDatum(vervalDatum), mailVerstuurd: mailVerstuurd };
  }
}

/**
 * Importeert leden in bulk: alleen Lidnummer, Naam, Email verplicht, Achternaam optioneel.
 * Type/Saldo/Vervaldatum blijven bewust leeg - dat rond je per lid af via voltooiLid().
 * Bestaande lidnummers en dubbele lidnummers binnen de import worden overgeslagen.
 */
function importeerLeden(rijen, uitgevoerdDoor) {
  if (!Array.isArray(rijen) || rijen.length === 0) throw new Error('Geen rijen om te importeren');

  const sheet = getSheet();
  const gezienInBatch = {};
  const nieuweRijen = [];
  let overgeslagen = 0;

  rijen.forEach(function (r) {
    const lidnummer = String(r.lidnummer || '').trim();
    const naam = String(r.naam || '').trim();
    const achternaam = String(r.achternaam || '').trim();
    const email = String(r.email || '').trim();

    if (!lidnummer || !naam || !email) { overgeslagen++; return; }
    if (gezienInBatch[lidnummer]) { overgeslagen++; return; }
    if (findRowByLidnummer(lidnummer) !== -1) { overgeslagen++; return; }

    gezienInBatch[lidnummer] = true;
    const token = Utilities.getUuid();
    nieuweRijen.push([lidnummer, naam, email, token, '', '', new Date(), '', '', achternaam]);
  });

  if (nieuweRijen.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, nieuweRijen.length, 10).setValues(nieuweRijen);
    logScan('-', '-', 'Import: ' + nieuweRijen.length + ' leden toegevoegd, ' + overgeslagen + ' overgeslagen', '', uitgevoerdDoor);
  }

  return { toegevoegd: nieuweRijen.length, overgeslagen: overgeslagen };
}

/**
 * Loopt alle leden langs en genereert een Token voor rijen die er nog geen hebben
 * (bv. na handmatig toevoegen/plakken in de Sheet buiten de app om). Eén
 * samenvattende logregel i.p.v. één per lid.
 */
function vulOntbrekendeTokensAan(uitgevoerdDoor) {
  const sheet = getSheet();
  const laatsteRij = sheet.getLastRow();
  if (laatsteRij < 2) return { aangevuld: 0 };

  const tokenBereik = sheet.getRange(2, 4, laatsteRij - 1, 1);
  const tokens = tokenBereik.getValues();
  let aangevuld = 0;

  for (let i = 0; i < tokens.length; i++) {
    const lidnummer = sheet.getRange(i + 2, 1).getValue();
    if (!lidnummer) continue; // lege rij overslaan
    if (!tokens[i][0]) {
      tokens[i][0] = Utilities.getUuid();
      aangevuld++;
    }
  }

  if (aangevuld > 0) {
    tokenBereik.setValues(tokens);
    logScan('-', '-', 'Onderhoud: Tokens aangevuld voor ' + aangevuld + ' leden', '', uitgevoerdDoor);
  }

  return { aangevuld: aangevuld };
}

/**
 * "Update-import": zet de Vervaldatum van bestaande Abonnement-leden gelijk aan wat
 * een externe ledenadministratie aanlevert (Lidnummer + Vervaldatum). Overschrijft
 * altijd (geen optellen/verlengen) - de externe administratie is leidend. Werkt
 * alleen voor leden die al Type=Abonnement hebben; andere lidnummers worden
 * overgeslagen (de admin-app filtert dat al voor bij de preview, maar deze functie
 * controleert het defensief nogmaals).
 */
function importeerAbonnementUpdates(rijen, uitgevoerdDoor) {
  if (!Array.isArray(rijen) || rijen.length === 0) throw new Error('Geen rijen om te verwerken');

  const sheet = getSheet();
  let bijgewerkt = 0, overgeslagen = 0;

  rijen.forEach(function (r) {
    const lidnummer = String(r.lidnummer || '').trim();
    const vervaldatumRuw = String(r.vervaldatum || '').trim();
    if (!lidnummer || !vervaldatumRuw) { overgeslagen++; return; }

    const datum = new Date(vervaldatumRuw);
    if (isNaN(datum.getTime())) { overgeslagen++; return; }

    const row = findRowByLidnummer(lidnummer);
    if (row === -1) { overgeslagen++; return; }

    const huidigType = sheet.getRange(row, 8).getValue();
    if (huidigType !== TYPE_ABONNEMENT) { overgeslagen++; return; }

    sheet.getRange(row, 9).setValue(datum);
    bijgewerkt++;
  });

  if (bijgewerkt > 0) {
    logScan('-', '-', 'Import abonnement-update: ' + bijgewerkt + ' bijgewerkt, ' + overgeslagen + ' overgeslagen', '', uitgevoerdDoor);
  }

  return { bijgewerkt: bijgewerkt, overgeslagen: overgeslagen };
}

function getMemberInfo(lidnummer) {
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Lid niet gevonden');
  const sheet = getSheet();
  return {
    lidnummer: lidnummer,
    naam: sheet.getRange(row, 2).getValue(),
    achternaam: sheet.getRange(row, 10).getValue() || '',
    email: sheet.getRange(row, 3).getValue(),
    type: sheet.getRange(row, 8).getValue() || '',
    token: sheet.getRange(row, 4).getValue(),
    saldo: sheet.getRange(row, 5).getValue(),
    vervalDatum: formatDatum(sheet.getRange(row, 9).getValue())
  };
}

function deleteMember(lidnummer, uitgevoerdDoor) {
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Lid niet gevonden');
  const sheet = getSheet();
  const naam = sheet.getRange(row, 2).getValue();
  sheet.deleteRow(row);
  logScan(lidnummer, naam, 'Lid verwijderd', '', uitgevoerdDoor);
  return { lidnummer: lidnummer, verwijderd: true };
}

function topUpRitten(lidnummer, aantal, stuurMail, uitgevoerdDoor) {
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Lid niet gevonden');
  const sheet = getSheet();
  const type = sheet.getRange(row, 8).getValue();
  if (!type) throw new Error('Dit lid heeft nog geen Ritten/Abonnement - voltooi eerst de registratie');
  if (type !== TYPE_RITTEN) throw new Error('Dit lid heeft een abonnement, geen rittenkaart');

  const n = Number(aantal);
  if (!n || n <= 0) throw new Error('Ongeldig aantal ritten');

  const naam = sheet.getRange(row, 2).getValue();
  const email = sheet.getRange(row, 3).getValue();
  const huidig = Number(sheet.getRange(row, 5).getValue());
  const nieuw = huidig + n;
  sheet.getRange(row, 5).setValue(nieuw);

  const huidigeVervalRaw = sheet.getRange(row, 9).getValue();
  const basisDatum = vervaldatumIsGeldig(huidigeVervalRaw) ? new Date(huidigeVervalRaw) : new Date();
  const nieuweVervalDatum = voegMaandenToe(basisDatum, getRittenHoudbaarheidMaanden());
  sheet.getRange(row, 9).setValue(nieuweVervalDatum);

  logScan(lidnummer, naam, 'Opgewaardeerd met ' + n + ' ritten (houdbaar t/m ' + formatDatum(nieuweVervalDatum) + ')', nieuw, uitgevoerdDoor);

  let mailVerstuurd = false;
  if (stuurMail) mailVerstuurd = verstuurMailMetLock(lidnummer, function () { stuurOpwaardeerMail(naam, email, n, nieuw); });
  return { lidnummer: lidnummer, nieuwSaldo: nieuw, nieuweVervalDatum: formatDatum(nieuweVervalDatum), mailVerstuurd: mailVerstuurd };
}

function verlengAbonnement(lidnummer, duur, stuurMail, uitgevoerdDoor) {
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Lid niet gevonden');
  const sheet = getSheet();
  const type = sheet.getRange(row, 8).getValue();
  if (!type) throw new Error('Dit lid heeft nog geen Ritten/Abonnement - voltooi eerst de registratie');
  if (type !== TYPE_ABONNEMENT) throw new Error('Dit lid heeft geen abonnement');

  const naam = sheet.getRange(row, 2).getValue();
  const email = sheet.getRange(row, 3).getValue();
  const huidigeVervalRaw = sheet.getRange(row, 9).getValue();
  const basisDatum = vervaldatumIsGeldig(huidigeVervalRaw) ? new Date(huidigeVervalRaw) : new Date();
  const nieuweVervalDatum = berekenVervalDatum(basisDatum, duur);

  sheet.getRange(row, 9).setValue(nieuweVervalDatum);
  logScan(lidnummer, naam, 'Abonnement verlengd (' + duur + ')', '', uitgevoerdDoor);

  let mailVerstuurd = false;
  if (stuurMail) mailVerstuurd = verstuurMailMetLock(lidnummer, function () { stuurAbonnementVerlengdMail(naam, email, nieuweVervalDatum); });
  return { lidnummer: lidnummer, nieuweVervalDatum: formatDatum(nieuweVervalDatum), mailVerstuurd: mailVerstuurd };
}

function stuurWelkomstMailOpnieuw(lidnummer, uitgevoerdDoor) {
  const row = findRowByLidnummer(lidnummer);
  if (row === -1) throw new Error('Lid niet gevonden');
  const sheet = getSheet();
  const naam = sheet.getRange(row, 2).getValue();
  const email = sheet.getRange(row, 3).getValue();
  const token = sheet.getRange(row, 4).getValue();
  const type = sheet.getRange(row, 8).getValue();
  if (!type) throw new Error('Dit lid heeft nog geen Ritten/Abonnement - voltooi eerst de registratie');

  const mailVerstuurd = verstuurMailMetLock(lidnummer, function () {
    if (type === TYPE_ABONNEMENT) {
      const vervalRaw = sheet.getRange(row, 9).getValue();
      stuurWelkomstMailAbonnement(naam, email, token, lidnummer, vervalRaw);
    } else {
      stuurWelkomstMailRitten(naam, email, token, lidnummer);
    }
  });

  if (mailVerstuurd) {
    logScan(lidnummer, naam, 'QR-code opnieuw gemaild', '', uitgevoerdDoor);
  }
  return { lidnummer: lidnummer, email: email, mailVerstuurd: mailVerstuurd };
}

function getMembers() {
  const data = getSheet().getDataRange().getValues();
  const leden = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const type = data[i][7] || '';
    const vervalRaw = data[i][8];
    const saldoOfVervalRuw = !type ? -1 : (type === TYPE_ABONNEMENT ? (vervalRaw ? new Date(vervalRaw).getTime() : 0) : Number(data[i][4]) || 0);
    leden.push({
      lidnummer: data[i][0],
      naam: data[i][1],
      achternaam: data[i][9] || '',
      email: data[i][2],
      type: type,
      saldo: data[i][4],
      vervalDatum: vervalRaw ? formatDatum(vervalRaw) : '',
      verlopen: vervalRaw ? !vervaldatumIsGeldig(vervalRaw) : false,
      laatsteScan: data[i][5] ? new Date(data[i][5]).toLocaleString('nl-NL') : '',
      laatsteScanTijd: data[i][5] ? new Date(data[i][5]).getTime() : 0,
      saldoOfVervalRuw: saldoOfVervalRuw
    });
  }
  return leden;
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
  const type = sheet.getRange(row, 8).getValue();
  const vervalRaw = sheet.getRange(row, 9).getValue();
  const laatsteScanRaw = sheet.getRange(row, 6).getValue();
  const laatsteBezoek = laatsteScanRaw ? new Date(laatsteScanRaw).toLocaleString('nl-NL') : 'Nog niet geweest';

  if (!type) {
    return { naam: naam, token: token, type: '', onvolledig: true, laatsteBezoek: laatsteBezoek };
  }

  if (type === TYPE_ABONNEMENT) {
    return {
      naam: naam, token: token, type: type,
      vervalDatum: formatDatum(vervalRaw),
      geldig: vervaldatumIsGeldig(vervalRaw),
      laatsteBezoek: laatsteBezoek
    };
  }

  return {
    naam: naam, token: token, type: type,
    saldo: sheet.getRange(row, 5).getValue(),
    vervalDatum: vervalRaw ? formatDatum(vervalRaw) : '',
    laatsteBezoek: laatsteBezoek
  };
}

/** Haalt een QR-afbeelding op voor een token - geeft een duidelijke foutmelding bij een lege/ontbrekende token. */
function haalQrBlobOp(token, lidnummer) {
  if (!token) {
    throw new Error('Lid ' + lidnummer + ' heeft geen Token - gebruik "Vul ontbrekende tokens aan" bij Instellingen en probeer daarna opnieuw.');
  }
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(token);
  return UrlFetchApp.fetch(qrUrl).getBlob().setName('rittenkaart-qr.png');
}

function stuurWelkomstMailRitten(naam, email, token, lidnummer) {
  const verenigingNaam = getVerenigingNaam();
  const blob = haalQrBlobOp(token, lidnummer);
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

function stuurWelkomstMailAbonnement(naam, email, token, lidnummer, vervalDatum) {
  const verenigingNaam = getVerenigingNaam();
  const blob = haalQrBlobOp(token, lidnummer);
  const lidAppUrl = getLidAppUrl();

  let html =
    '<p>Beste ' + naam + ',</p>' +
    '<p>Hierbij je persoonlijke toegangskaart voor ' + verenigingNaam + ' (lidnummer ' + lidnummer + '). ' +
    'Je abonnement is geldig t/m <strong>' + formatDatum(vervalDatum) + '</strong>.</p>' +
    '<p>Toon onderstaande QR-code bij binnenkomst voor toegang.</p>' +
    '<img src="cid:qrcode" width="300" height="300" />' +
    '<p>Bewaar deze e-mail goed &mdash; je hebt de code bij elk bezoek nodig.</p>';

  if (lidAppUrl) {
    html +=
      '<p>Wil je op elk moment je vervaldatum en laatste bezoek bekijken? Ga naar ' +
      '<a href="' + lidAppUrl + '">' + lidAppUrl + '</a> en vul je lidnummer en e-mailadres in.</p>';
  }

  MailApp.sendEmail({
    to: email,
    subject: 'Jouw toegangskaart voor ' + verenigingNaam,
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

function stuurAbonnementVerlengdMail(naam, email, nieuweVervalDatum) {
  const verenigingNaam = getVerenigingNaam();
  const lidAppUrl = getLidAppUrl();

  let html =
    '<p>Beste ' + naam + ',</p>' +
    '<p>Je abonnement is verlengd. Je bent nu geldig lid t/m <strong>' +
    formatDatum(nieuweVervalDatum) + '</strong>.</p>';

  if (lidAppUrl) {
    html +=
      '<p>Wil je je gegevens op elk moment bekijken? Ga naar ' +
      '<a href="' + lidAppUrl + '">' + lidAppUrl + '</a> en vul je lidnummer en e-mailadres in.</p>';
  }

  html += '<p>Tot ziens bij ' + verenigingNaam + '!</p>';

  MailApp.sendEmail({
    to: email,
    subject: 'Je abonnement is verlengd - ' + verenigingNaam,
    htmlBody: html
  });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
