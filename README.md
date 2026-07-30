<img width="807" height="450" alt="qr scan 1784971454" src="https://github.com/user-attachments/assets/0994c996-6e69-4113-bec7-fb8fe4f0e778" />

## eRittenkaart  
##   de Makkelijkste manier, ook zonder apps en installatie mogelijk
Deze 'app' neemt de zorgen voor ritten kaarten uit handen. Het is voor verenigingen die de toegang tot hun faciliteiten per keer (rit) aanbieden. De 'apps' zijn gewone webpagina's die op de telefoon op computer werken. 


## Vraag voor demo account
Uitproberen?  Op maat gemaakte eRittenkaart? of een kant en klare oplossing? Ik ben bereikbaar op  rich.de.ree@gmail.com

##   de eRittenkaart apps
## 1. Scanner   
App voor telefoon. Scanned de QR code een geeft toegang en trekt 1 rit af, of geeft reden waarom geweigerd.
De app, is als webpagina gemaakt en werkt op vrijwel iedere telefoon.

	[Try Admin](https://rich7.github.io/rittenkaart/scanner.html)

## 2. Admin tool.  
Voegt rittenkaarten toe, verstuurd email met nieuwe kaart (QR code). opwaarderen kaart, kaarten overzicht.  Instellingen

	[Try Admin](https://rich7.github.io/rittenkaart/admin.html)

## 3. Leden app. 
QR code uit Email is voldoende.
Optioneel kan lid de leden app gebruiken
Laat toegangs QR code zien, laatste datum afschrijving en resterend tegoed

	[Try leden screen]](https://rich7.github.io/rittenkaart/leden.html)

## 4. Opslag kaarten en activiteiten log op Google Sheets 
Backend opslag voor rittenkaarten. Activiteiten log met alle scans en opwaarderingen 

Screenshot Google sheets (backend, **Wordt automatisch bijgehouden**)  

<img width="2092" height="752" alt="Wordt automatisch bijgehouden " src="https://github.com/user-attachments/assets/ce2a94c2-85a2-42a1-8680-3243646528a0" />

Screenshot Google sheets (Logboek, **Wordt automatisch bijgehouden**)  

<img width="1129" height="296" alt="rit log chrome_1mZIpOqx2e" src="https://github.com/user-attachments/assets/d645167e-08e5-4d38-badc-572e1957c165" />


## Richard's digitale werkplaats
<img width="1408" height="768" alt="logo RDW Richard digitale werkplaats" src="https://github.com/user-attachments/assets/36e8a5ad-af5e-4ba9-b455-90d5004cce44" />







# Rittenkaart-app - installatie

## 1. Google Sheet aanmaken
0. Maak Google account aan of gebruik bestaand account.
1. Maak een nieuwe Google Sheet.
2. Hernoem het eerste tabblad naar exact `Leden`.
3. Zet in rij 1 deze koppen (kolom A t/m G):
   `Lidnummer | Naam | Email | Token | Saldo | LaatsteScan | AangemaaktOp`

## 2. Apps Script koppelen
1. In de Sheet: **Extensies > Apps Script**.
2. Verwijder de standaardinhoud en plak de inhoud van `Code.gs`.
[Naar code.gs](https://github.com/rich7/rittenkaart/blob/main/code.gs)
4. **Project instellingen > Scripteigenschappen**, voeg toe:
   - `ADMIN_PASSWORD` = een wachtwoord naar keuze
   - `VERENIGING_NAAM` = naam van de vereniging (komt in de mail en op de schermen)
5. **Implementeren > Nieuwe implementatie**
   - Type: **Webapp**
   - Uitvoeren als: **Ik**
   - Toegang: **Iedereen**
6. Kopieer de webapp-URL die je krijgt (eindigt op `/exec`).
7. Bij de eerste keer implementeren vraagt Google om machtigingen (Sheet lezen/schrijven, mail versturen) - accepteer die voor je eigen account.

## 3. HTML-bestanden instellen
Open `admin.html`, `scanner.html` en `lid.html` in een teksteditor en vervang in elk bestand:
```
const APPS_SCRIPT_URL = 'PLAK_HIER_JE_APPS_SCRIPT_WEBAPP_URL';
```
met de webapp-URL uit stap 2.

## 4. Hosten
Zet `admin.html`, `scanner.html` en `lid.html` op een webpagina. Ze zijn los van elkaar te gebruiken:
- `admin.html`: tabs voor nieuw lid toevoegen (mailt automatisch de QR-code), ritten opwaarderen, ledenoverzicht, en instellingen (berichtduur op de scanner).
- `scanner.html`: open dit op de telefoon/tablet bij de toegang, log in met het wachtwoord, laat de camera op de QR-code richten. Piept/trilt bij geslaagde/geweigerde scan
- `lid.html`: leden vullen hun lidnummer + e-mailadres in en zien hun eigen tegoed en laatste bezoek. Geen wachtwoord nodig - kan gewoon gedeeld worden als link.


## Log-tabblad
Er verschijnt automatisch een tweede tabblad "Log" in je Sheet zodra de eerste scan plaatsvindt. Daar staat elke scanpoging (geslaagd of geweigerd, met reden en wanneer er opgewaardeerd is).

## Vingerafdruk/Face ID inloggen
`admin.html` en `scanner.html` gebruiken inlogformulier, de browser kan aanbieden het wachtwoord om op te slaan. Zodra je dat op een telefoon/tablet één keer doet (bij het eerste keer inloggen kiest de browser/wachtwoordmanager voor "wachtwoord opslaan?"), vult diezelfde browser het wachtwoord bij een volgend bezoek automatisch in nadat je met Face ID/vingerafdruk hebt bevestigd - dat is standaardgedrag van de iOS Sleutelhanger / Google Wachtwoordmanager, enz.

## Nog open/te overwegen
- Wachtwoorden staan als platte tekst in Scripteigenschappen en worden bij elke aanroep meegestuurd - prima voor beperkte, vertrouwde toegang, maar geen bankwaardige beveiliging.
- 
- QR-afbeelding wordt gegenereerd via de gratis dienst api.qrserver.com. Werkt prima, maar is een externe afhankelijkheid.
- Er is nog geen manier om een lid te verwijderen/wachtwoord te wijzigen vanuit het adminpaneel zelf - dat kan rechtstreeks in de Sheet / Scripteigenschappen.
- 



---

## 📌 Over dit project / About this project

**Automated QR Punch Pass System for Clubs & Associations**

Deze open source rittenkaart-app automatiseert de ritten- en aanwezigheidsregistratie voor verenigingen, sportclubs en stichtingen. Met behulp van snelle QR-codescan worden ritten, beurten of sessies direct en foutloos bijgehouden op de digitale rittenkaart van het lid.

### Key Features
* 📱 **QR Code Scanning:** Snel scannen aan de deur of bij het instappen.
* ⚡ **Automatische verwerking:** Direct bijwerken van het resterende saldo/ritten.
* 🤝 **Open Source & Privacyvriendelijk:** Volledig naar eigen wens aan te passen en te beheren.
* 🏆 **Ideaal voor verenigingen:** Geschikt voor clubvervoer, sportlessen, workshops en evenementen.

---
**Keywords:** rittenkaart app, open source rittenregistratie, vereniging software, QR code scanner, digitale strippenkaart, punch pass app, session tracker, club management tool, beurtenkaart, rittenpas.
