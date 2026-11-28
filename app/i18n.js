// i18n.js — the app's words in English and Italian, and number formatting.
//
// t('key', { name: value }) gives the text in the current language, with {name} filled in; an entry can also
// be a function of those values (plurals, long paragraphs). A key missing in Italian falls back to English,
// and a key missing everywhere comes back as the key itself, so a gap shows on screen instead of breaking.
// nf(x, decimals) formats a number for the current language (Italian: decimal comma).
// applyStatic(root) fills the page: data-i18n (text), data-i18n-aria (aria-label), data-i18n-title (title).
// The language is stored on the phone; the first visit follows the browser (Italian if it is Italian).
// Pure parts are tested in i18n.test.js.

export const LANGS = { en: 'English', it: 'Italiano' };
const LANG_KEY = 'fuelprice.lang';

const EN = {
  // settings
  'set.title': 'Your vehicle',
  'set.language': 'Language',
  'set.vehicleType': 'Vehicle type',
  'set.fuel': 'Fuel',
  'set.price': 'Price (€/L)',
  'set.average': 'Average consumption (L/100 km), optional',
  'set.calc': 'Calc',
  'set.save': 'Save',
  'set.openAdvanced': 'Advanced settings\n(registration certificate)',
  'set.avgTooLow': 'This average is too low for this vehicle: it cannot be reached.',
  'common.cancel': 'Cancel',
  'common.close': 'Close',

  // footer (footer.js)
  'share.open': 'Share',
  'share.title': 'Share VerDrive',
  'share.qrAlt': 'QR code for {url}',
  'share.copy': 'Copy link',
  'share.copied': 'Copied!',
  'share.copyPrompt': 'Copy this link:',
  'share.text': 'Live fuel cost of your car, from GPS and a physics model.',
  'credits.open': 'Credits',
  'coffee.long': 'Buy me a coffee',
  'coffee.short': 'coffee?',
  'credits.loading': 'Loading…',
  'credits.failed': 'Could not load the credits. Read them online:',
  'install.open': 'Install',
  'install.title': 'Install VerDrive',
  'install.ios1': 'Tap the Share button',
  'install.ios2': 'Tap “Show more”',
  'install.ios3': 'Tap “Add to Home Screen”',
  'install.firefox': "Firefox on a computer can't install web apps.\nUse Chrome or Edge, or Firefox on Android (menu → Install).",
  'install.safari': 'To install: File → Add to Dock.',
  'install.other': 'To install: browser menu → "Install app" (or "Add to Home screen").\nAlready installed? Open it from your apps.',

  'veh.city': 'City car', 'veh.sedan': 'Sedan', 'veh.suv': 'SUV', 'veh.van': 'Van', 'veh.scooter': 'Scooter', 'veh.moto': 'Motorcycle',
  'fuel.gasoline': 'Gasoline', 'fuel.diesel': 'Diesel', 'fuel.lpg': 'LPG (GPL)', 'fuel.lpgShort': 'LPG',
  'body.hatchback': 'Hatchback', 'body.sedan': 'Sedan', 'body.estate': 'Estate', 'body.suv': 'SUV', 'body.van': 'Van',

  // advanced settings (Tier 2)
  'adv.title': 'Advanced settings',
  'adv.ledeCars': 'Copy these fields from your registration certificate (cars and vans, petrol, diesel or LPG; not hybrids or electric cars). They replace the rough presets and tune the fuel model to your car.',
  'adv.ledeMoto': 'Copy these fields from your registration certificate. The rider (75 kg) is added automatically. The fuel use itself is tuned by your average consumption (Calc button in the car settings).',
  'adv.g': 'G: mass in running order (kg), optional',
  'adv.gHint': 'Used only if G.1 is blank. If both are blank, the typical mass of your vehicle type is used.',
  'adv.g1': 'G.1: empty mass (kg), optional',
  'adv.g1Hint': 'G.1 is G without the driver. It is used first; G is the fallback.',
  'adv.f1': 'F.1: maximum laden mass (kg), optional',
  'adv.f2': 'F.2: maximum laden mass (kg), optional',
  'adv.f1Hint': 'If there is no F.1, use F.2.',
  'adv.f2Hint': 'Used to estimate the mass of the bike if there is no G.',
  'adv.p1': 'P.1: engine capacity (cm³)',
  'adv.p2': 'P.2: maximum power (kW)',
  'adv.v7': 'V.7: CO₂ emissions (g/km)',
  'adv.v7Hint': 'Tunes the fuel use of your car. Leave blank if the certificate has no WLTP value.',
  'adv.body': 'Body type',
  'adv.cda': 'CdA: drag area (m²), optional',
  'adv.cdaHint': 'Not on the certificate; search your model online. If you find the drag coefficient Cd and the frontal area A, multiply them (e.g. 0.30 × 2.2 m² = 0.66). Blank: the typical value for your vehicle type.',
  'adv.startStop': 'Start-stop',
  'adv.startStopHint': 'The engine switches off when the car stops.',
  'adv.save': 'Save advanced settings',
  'adv.remove': 'Go back to quick settings',
  'adv.resMoto': 'Tier 2 active. Mass with rider {m} kg, power clamp {p} kW.',
  'adv.resCar': 'Tier 2 active. Test mass {m} kg.',
  'adv.resOwn': 'Your own average {v} L/100 km sets k.',
  'adv.resOfficial': 'Official consumption {v} L/100 km, with the real-world factor {w}.',
  'adv.resK': 'Fuel constant k = {k} (Quick: {q}). The model gives {s} L/100 km on the {cycle} cycle.',
  'adv.cycleRef': 'reference',
  'adv.cycleWltp': 'WLTP',

  // field names and checks (profile.js)
  'field.g': 'G (mass in running order)',
  'field.g1': 'G.1 (empty mass)',
  'field.maxLaden': 'F.1 or F.2 (maximum laden mass)',
  'field.maxLadenMoto': 'F.2 (maximum laden mass)',
  'field.displacement': 'P.1 (engine capacity)',
  'field.ratedKw': 'P.2 (maximum power)',
  'field.co2': 'V.7 (CO₂)',
  'field.cda': 'CdA (drag area)',
  'field.price': 'The price',
  'field.average': 'Average consumption',
  'err.numberRange': '{name} should be a number between {min} and {max} {unit}.',
  'err.range': '{name} should be between {min} and {max} {unit}.',
  'err.needed': '{name} is needed.',
  'err.body': 'Choose a body type.',
  'err.gMinusG1': 'G minus G.1 is {d} kg, but the driver is {r} kg. Check both values, or leave one blank.',
  'err.laden': 'The maximum laden mass (F.1 or F.2) must be above the vehicle mass.',
  'err.aboveZero': 'Both values must be above zero.',
  'err.notNumber': 'Type numbers only, with at most one decimal separator ("." or ",").',
  'err.avgWrong': '{v} L/100 km looks wrong. {err}',
  'note.fMissing': 'No laden mass (F.1 or F.2) given: the WLTP test mass is the vehicle mass + 25 kg, without the payload share.',
  'note.fEstimate': "G not given: mass with rider estimated from the laden mass ({m} kg). It is rough and a little high, because the laden mass includes the manufacturer's luggage allowance.",
  'note.gAgree': 'G and G.1 agree (75 kg apart). Mass {m} kg.',
  'note.g1': 'Mass from G.1 (empty mass) + 75 kg driver: {m} kg.',
  'note.gMissing': 'G not given: the typical mass of this vehicle type ({m} kg) is used.',
  'note.cda': 'Drag area from your CdA: {v} m².',
  'note.motoAverage': 'Enter your average consumption (Calc button in the car settings) to tune the fuel use to your bike.',
  'note.motoLow': 'The average is too low for this idle rate: k keeps its Quick value.',
  'note.noFigure': 'No consumption figure given: the fuel constant k keeps its Quick value.',
  'note.tooLow': 'The consumption figure is too low for this idle rate: k keeps its Quick value. Check P.1, V.7 and your average.',
  'note.unusualK': 'The calibrated k is unusual. Check the figures against the certificate.',

  // dialogs
  'exp.title': 'Export last trip',
  'exp.from': 'From',
  'exp.to': 'To',
  'exp.note': 'Optional: added to the file name.',
  'exp.export': 'Export',
  'calc.title': 'Average consumption',
  'calc.litres': 'Fuel used (litres)',
  'calc.km': 'Distance covered (km)',
  'calc.enterBoth': 'Enter both values.',
  'calc.use': 'Use this value',

  // trip setup
  'setup.title': 'New trip',
  'setup.settings': 'Settings',
  'setup.vehicle': 'Vehicle',
  'setup.fuel': 'Fuel',
  'setup.fuelType': 'Fuel type',
  'setup.priceAria': 'Fuel price, euros per litre',
  'setup.people': 'People',
  'setup.onBike': 'On the bike',
  'setup.peopleHint': '+75 kg each',
  'setup.fewer': 'Fewer people',
  'setup.more': 'More people',
  'setup.cold': 'Cold start',
  'setup.coldHint': 'Engine not yet warm. Recorded now, applied in a later version.',
  'setup.demo': 'Demo drive',
  'setup.start': 'Start trip',
  'setup.replay': 'Replay trip',
  'setup.export': 'Export last trip',
  'tier.quick': 'Tier 1 · Quick',
  'tier.adv': 'Tier 2 · Advanced',
  'recap.average': 'Your average: {v}',
  'replay.noGps': 'This file has no GPS readings to replay.',
  'replay.notLog': 'This file is not a VerDrive trip log.',

  // GPS line
  'gps.waiting': 'Waiting for GPS…',
  'gps.weakHeld': '{acc} · weak signal, reading held',
  'gps.weak': '{acc} · weak signal',
  'gps.held': '{acc} · reading held',
  'gps.notPrecise': '{acc} · not precise yet',
  'gps.noAlt': '{acc} · no altitude',
  'gps.altSettling': '{acc} · altitude settling',
  'gps.alt': '{acc} · altitude {h} m',
  'gps.unsupported': 'This browser has no location support.',
  'gps.denied': 'Location is blocked. Allow it for this site in your browser settings, then reload.',
  'gps.lost': 'GPS signal lost. Waiting for it to return…',
  'gps.bars': 'GPS signal: {n} of 5',
  'gps.barsNone': 'GPS signal: none',

  // trip screen
  'trip.legendTrip': 'trip',
  'trip.legendRecent': 'last 5 min',
  'trip.box': 'trip',
  'trip.distance': 'distance',
  'trip.consumption': 'consumption',
  'trip.cost': 'cost',
  'trip.consAria': 'Consumption, tap to switch between L/100 km and km/L',
  'trip.speedAria': 'Speed, tap to show it on the dial',
  'trip.costAria': 'Cost dial; the lights above pick its unit',
  'trip.dialUnit': 'Dial unit',
  'trip.ac': 'A/C',
  'trip.pause': 'Pause',
  'trip.resume': 'Resume',
  'trip.paused': 'Paused',
  'trip.stop': 'Hold to stop',

  // summary
  'sum.title': 'Trip summary',
  'sum.profile': 'Altitude profile',
  'sum.profileAria': 'Altitude profile: from {min} to {max} m over {km} km',
  'sum.profileTap': 'Tap to switch between altitude and speed',
  'sum.speedProfile': 'Speed',
  'sum.distance': 'Distance',
  'sum.time': 'Time',
  'sum.fuel': 'Fuel',
  'sum.total': 'Total cost',
  'sum.average': 'Cost/h',
  'sum.consumption': 'Rate',
  'sum.co2': 'CO₂',
  'sum.tree': '🌳 Time to absorb',
  'sum.ac': 'A/C',
  'sum.style': 'Driving style',
  'style.eco': 'Eco',
  'style.ok': 'OK',
  'style.brisk': 'Brisk',
  'style.bad': 'Bad',
  'style.accel': 'accelerations',
  'style.speed': 'speed',
  'sum.replay': 'Replay of {file}\nwith {vehicle} · {fuel} · €{price}/L',
  'sum.export': 'Export log',
  'sum.newTrip': 'New trip',
  'tree.lessThanDay': 'less than a day',
  'tree.days': ({ n }) => `~${n} ${n === 1 ? 'day' : 'days'}`,
  'tree.weeks': '~{n} weeks',
  'tree.months': '~{n} months',
  'tree.years': '~{n} years',
  'tree.detail': ({ litres, fuel, perLitre, co2, perYear, time, days }) =>
    `This trip burned ${litres} L of ${fuel}. Each litre releases about ${perLitre} kg of CO₂ when burned, so the trip emitted ${co2} kg. ` +
    `A typical mature tree absorbs about ${perYear} kg of CO₂ per year (estimates range from 15 to 25 kg, depending on species and size), ` +
    `so one tree would need ${time} (${days} days) to take it back up. Only the fuel burned in the engine is counted, not its production or transport.`,
  'version': 'Version {id}',
};

const IT = {
  'set.title': 'Il tuo veicolo',
  'set.language': 'Lingua',
  'set.vehicleType': 'Tipo di veicolo',
  'set.fuel': 'Carburante',
  'set.price': 'Prezzo (€/L)',
  'set.average': 'Consumo medio (km/L), facoltativo',
  'set.calc': 'Calcola',
  'set.save': 'Salva',
  'set.openAdvanced': 'Impostazioni avanzate\n(carta di circolazione)',
  'set.avgTooLow': 'Questo consumo medio è troppo basso per questo veicolo: non è raggiungibile.',
  'common.cancel': 'Annulla',
  'common.close': 'Chiudi',

  'share.open': 'Condividi',
  'share.title': 'Condividi VerDrive',
  'share.qrAlt': 'Codice QR per {url}',
  'share.copy': 'Copia link',
  'share.copied': 'Copiato!',
  'share.copyPrompt': 'Copia questo link:',
  'share.text': 'Il costo del carburante della tua auto in tempo reale, da GPS e un modello fisico.',
  'credits.open': 'Crediti',
  'coffee.long': 'Offrimi un caffè',
  'coffee.short': 'caffè?',
  'credits.loading': 'Caricamento…',
  'credits.failed': 'Impossibile caricare i crediti. Leggili online:',
  'install.open': 'Installa',
  'install.title': 'Installa VerDrive',
  'install.ios1': 'Tocca il pulsante Condividi',
  'install.ios2': 'Tocca “Mostra altro”',
  'install.ios3': 'Tocca “Aggiungi alla schermata Home”',
  'install.firefox': 'Firefox su computer non installa app web.\nUsa Chrome o Edge, oppure Firefox su Android (menu → Installa).',
  'install.safari': 'Per installare: File → Aggiungi al Dock.',
  'install.other': 'Per installare: menu del browser → "Installa app" (o "Aggiungi a schermata Home").\nGià installata? Aprila dalle tue app.',

  'veh.city': 'Citycar', 'veh.sedan': 'Berlina', 'veh.suv': 'SUV', 'veh.van': 'Furgone', 'veh.scooter': 'Scooter', 'veh.moto': 'Moto',
  'fuel.gasoline': 'Benzina', 'fuel.diesel': 'Gasolio', 'fuel.lpg': 'GPL', 'fuel.lpgShort': 'GPL',
  'body.hatchback': 'Due volumi', 'body.sedan': 'Berlina', 'body.estate': 'Station wagon', 'body.suv': 'SUV', 'body.van': 'Furgone',

  'adv.title': 'Impostazioni avanzate',
  'adv.ledeCars': 'Copia questi campi dalla carta di circolazione (auto e furgoni a benzina, gasolio o GPL; non ibride né elettriche). Sostituiscono i valori indicativi e adattano il modello di consumo alla tua auto.',
  'adv.ledeMoto': 'Copia questi campi dalla carta di circolazione. Il conducente (75 kg) è aggiunto automaticamente. Il consumo si adatta con il tuo consumo medio (pulsante Calcola nelle impostazioni del veicolo).',
  'adv.g': 'G: massa in ordine di marcia (kg), facoltativo',
  'adv.gHint': 'Usato solo se G.1 è vuoto. Se sono vuoti entrambi, si usa la massa tipica del tuo tipo di veicolo.',
  'adv.g1': 'G.1: massa a vuoto (kg), facoltativo',
  'adv.g1Hint': 'G.1 è G senza il conducente. Si usa per primo; G è la riserva.',
  'adv.f1': 'F.1: massa massima a pieno carico (kg), facoltativo',
  'adv.f2': 'F.2: massa massima a pieno carico (kg), facoltativo',
  'adv.f1Hint': 'Se manca F.1, usa F.2.',
  'adv.f2Hint': 'Serve a stimare la massa della moto se manca G.',
  'adv.p1': 'P.1: cilindrata (cm³)',
  'adv.p2': 'P.2: potenza massima (kW)',
  'adv.v7': 'V.7: emissioni di CO₂ (g/km)',
  'adv.v7Hint': 'Adatta il consumo della tua auto. Lascia vuoto se la carta non riporta un valore WLTP.',
  'adv.body': 'Carrozzeria',
  'adv.cda': 'CdA: area di resistenza (m²), facoltativo',
  'adv.cdaHint': 'Non è sulla carta di circolazione: cerca il tuo modello online. Se trovi il coefficiente Cx e l’area frontale A, moltiplicali (es. 0,30 × 2,2 m² = 0,66). Vuoto: il valore tipico del tuo tipo di veicolo.',
  'adv.startStop': 'Start-stop',
  'adv.startStopHint': "Il motore si spegne quando l'auto si ferma.",
  'adv.save': 'Salva impostazioni avanzate',
  'adv.remove': 'Torna alle impostazioni rapide',
  'adv.resMoto': 'Livello 2 attivo. Massa con conducente {m} kg, limite di potenza {p} kW.',
  'adv.resCar': 'Livello 2 attivo. Massa di prova {m} kg.',
  'adv.resOwn': 'Il tuo consumo medio di {v} L/100 km determina k.',
  'adv.resOfficial': "Consumo ufficiale {v} L/100 km, con il fattore d'uso reale {w}.",
  'adv.resK': 'Costante di consumo k = {k} (Rapido: {q}). Il modello dà {s} L/100 km sul ciclo {cycle}.',
  'adv.cycleRef': 'di riferimento',
  'adv.cycleWltp': 'WLTP',

  'field.g': 'G (massa in ordine di marcia)',
  'field.g1': 'G.1 (massa a vuoto)',
  'field.maxLaden': 'F.1 o F.2 (massa massima a pieno carico)',
  'field.maxLadenMoto': 'F.2 (massa massima a pieno carico)',
  'field.displacement': 'P.1 (cilindrata)',
  'field.ratedKw': 'P.2 (potenza massima)',
  'field.co2': 'V.7 (CO₂)',
  'field.cda': 'CdA (area di resistenza)',
  'field.price': 'Il prezzo',
  'field.average': 'Consumo medio',
  'err.numberRange': '{name}: serve un numero tra {min} e {max} {unit}.',
  'err.range': '{name}: deve essere tra {min} e {max} {unit}.',
  'err.needed': '{name}: campo necessario.',
  'err.body': 'Scegli una carrozzeria.',
  'err.gMinusG1': 'G meno G.1 fa {d} kg, ma il conducente pesa {r} kg. Controlla i due valori o lasciane uno vuoto.',
  'err.laden': 'La massa massima a pieno carico (F.1 o F.2) deve superare la massa del veicolo.',
  'err.aboveZero': 'Entrambi i valori devono essere maggiori di zero.',
  'err.notNumber': 'Scrivi solo numeri, con al massimo un separatore decimale ("." o ",").',
  'err.avgWrong': '{v} L/100 km non sembra corretto. {err}',
  'note.fMissing': 'Nessuna massa a pieno carico (F.1 o F.2): la massa di prova WLTP è la massa del veicolo + 25 kg, senza la quota di carico.',
  'note.fEstimate': 'G non indicato: massa con conducente stimata dalla massa a pieno carico ({m} kg). È approssimativa e un po’ alta, perché la massa a pieno carico include il bagaglio previsto dal costruttore.',
  'note.gAgree': 'G e G.1 concordano (75 kg di differenza). Massa {m} kg.',
  'note.g1': 'Massa da G.1 (massa a vuoto) + 75 kg di conducente: {m} kg.',
  'note.gMissing': 'G non indicato: si usa la massa tipica di questo tipo di veicolo ({m} kg).',
  'note.cda': 'Area di resistenza dal tuo CdA: {v} m².',
  'note.motoAverage': 'Inserisci il tuo consumo medio (pulsante Calcola nelle impostazioni del veicolo) per adattare il consumo alla tua moto.',
  'note.motoLow': 'Il consumo medio è troppo basso per questo consumo al minimo: k mantiene il valore rapido.',
  'note.noFigure': 'Nessun dato di consumo: la costante k mantiene il valore rapido.',
  'note.tooLow': 'Il dato di consumo è troppo basso per questo consumo al minimo: k mantiene il valore rapido. Controlla P.1, V.7 e il tuo consumo medio.',
  'note.unusualK': 'Il k calibrato è insolito. Confronta i valori con la carta di circolazione.',

  'exp.title': 'Esporta ultimo viaggio',
  'exp.from': 'Da',
  'exp.to': 'A',
  'exp.note': 'Facoltativi: aggiunti al nome del file.',
  'exp.export': 'Esporta',
  'calc.title': 'Consumo medio',
  'calc.litres': 'Carburante usato (litri)',
  'calc.km': 'Distanza percorsa (km)',
  'calc.enterBoth': 'Inserisci entrambi i valori.',
  'calc.use': 'Usa questo valore',

  'setup.title': 'Nuovo viaggio',
  'setup.settings': 'Impostazioni',
  'setup.vehicle': 'Veicolo',
  'setup.fuel': 'Carburante',
  'setup.fuelType': 'Tipo di carburante',
  'setup.priceAria': 'Prezzo del carburante, euro al litro',
  'setup.people': 'Persone',
  'setup.onBike': 'Sulla moto',
  'setup.peopleHint': '+75 kg ciascuna',
  'setup.fewer': 'Meno persone',
  'setup.more': 'Più persone',
  'setup.cold': 'Avviamento a freddo',
  'setup.coldHint': 'Motore non ancora caldo. Registrato ora, applicato in una versione futura.',
  'setup.demo': 'Prova demo',
  'setup.start': 'Inizia viaggio',
  'setup.replay': 'Rivedi viaggio',
  'setup.export': 'Esporta ultimo',
  'tier.quick': 'Livello 1 · Rapido',
  'tier.adv': 'Livello 2 · Avanzato',
  'recap.average': 'Il tuo consumo medio: {v}',
  'replay.noGps': 'Questo file non contiene letture GPS da rivedere.',
  'replay.notLog': 'Questo file non è un log di viaggio VerDrive.',

  'gps.waiting': 'In attesa del GPS…',
  'gps.weakHeld': '{acc} · segnale debole, lettura ferma',
  'gps.weak': '{acc} · segnale debole',
  'gps.held': '{acc} · lettura ferma',
  'gps.notPrecise': '{acc} · non ancora preciso',
  'gps.noAlt': '{acc} · nessuna altitudine',
  'gps.altSettling': '{acc} · altitudine in assestamento',
  'gps.alt': '{acc} · altitudine {h} m',
  'gps.unsupported': 'Questo browser non supporta la localizzazione.',
  'gps.denied': 'La localizzazione è bloccata. Consentila per questo sito nelle impostazioni del browser, poi ricarica.',
  'gps.lost': 'Segnale GPS perso. In attesa che ritorni…',
  'gps.bars': 'Segnale GPS: {n} su 5',
  'gps.barsNone': 'Segnale GPS: assente',

  'trip.legendTrip': 'viaggio',
  'trip.legendRecent': 'ultimi 5 min',
  'trip.box': 'viaggio',
  'trip.distance': 'distanza',
  'trip.consumption': 'consumo',
  'trip.cost': 'costo',
  'trip.consAria': 'Consumo, tocca per passare tra L/100 km e km/L',
  'trip.speedAria': 'Velocità, tocca per mostrarla sul quadrante',
  'trip.costAria': 'Quadrante del costo; le luci sopra ne scelgono l’unità',
  'trip.dialUnit': 'Unità del quadrante',
  'trip.ac': 'A/C',
  'trip.pause': 'Pausa',
  'trip.resume': 'Riprendi',
  'trip.paused': 'In pausa',
  'trip.stop': 'Tieni per fermare',

  'sum.title': 'Riepilogo del viaggio',
  'sum.profile': 'Profilo altimetrico',
  'sum.profileAria': 'Profilo altimetrico: da {min} a {max} m su {km} km',
  'sum.profileTap': 'Tocca per passare tra altitudine e velocità',
  'sum.speedProfile': 'Velocità',
  'sum.distance': 'Distanza',
  'sum.time': 'Tempo',
  'sum.fuel': 'Carburante',
  'sum.total': 'Costo totale',
  'sum.average': 'Costo/h',
  'sum.consumption': 'Consumo',
  'sum.co2': 'CO₂',
  'sum.tree': '🌳 Tempo di assorbimento',
  'sum.ac': 'Clima',
  'sum.style': 'Stile di guida',
  'style.eco': 'Eco',
  'style.ok': 'OK',
  'style.brisk': 'Vivace',
  'style.bad': 'Scarso',
  'style.accel': 'accelerazioni',
  'style.speed': 'velocità',
  'sum.replay': 'Viaggio rivisto: {file}\ncon {vehicle} · {fuel} · €{price}/L',
  'sum.export': 'Esporta log',
  'sum.newTrip': 'Nuovo viaggio',
  'tree.lessThanDay': 'meno di un giorno',
  'tree.days': ({ n }) => `~${n} ${n === 1 ? 'giorno' : 'giorni'}`,
  'tree.weeks': '~{n} settimane',
  'tree.months': '~{n} mesi',
  'tree.years': '~{n} anni',
  'tree.detail': ({ litres, fuel, perLitre, co2, perYear, time, days }) =>
    `Questo viaggio ha bruciato ${litres} L di ${fuel}. Ogni litro bruciato libera circa ${perLitre} kg di CO₂, quindi il viaggio ne ha emessi ${co2} kg. ` +
    `Un albero adulto tipico assorbe circa ${perYear} kg di CO₂ l'anno (le stime vanno da 15 a 25 kg, secondo specie e dimensioni), ` +
    `quindi un albero impiegherebbe ${time} (${days} giorni) a riassorbirla. Conta solo il carburante bruciato nel motore, non la sua produzione né il trasporto.`,
  'version': 'Versione {id}',
};

const DICTS = { en: EN, it: IT };
let lang = 'en';

/** The language to start with: the saved one, else Italian for an Italian browser, else English. */
export function initialLang(saved, browserLangs = []) {
  if (saved in LANGS) return saved;
  return browserLangs.some((l) => String(l).toLowerCase().startsWith('it')) ? 'it' : 'en';
}

export function getLang() { return lang; }
export function setLang(l) { if (l in LANGS) lang = l; }

/** Text for a key in the current language, with {name} placeholders filled from vars. */
export function t(key, vars = {}) {
  const entry = DICTS[lang][key] ?? EN[key];
  if (entry === undefined) return key;
  if (typeof entry === 'function') return entry(vars);
  return entry.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** A number with fixed decimals in the current language: 1.5 → "1.5" (en), "1,5" (it). No thousands separator. */
export function nf(x, decimals = 0) {
  const s = Number(x).toFixed(decimals);
  return lang === 'it' ? s.replace('.', ',') : s;
}

/**
 * Typed decimal text to a number. Either "." or "," is the decimal separator, whatever the language; at most one
 * separator, no sign, no thousands grouping ("1,234.5" and "1.2.3" are invalid). Blank gives null; anything else
 * that is not such a number gives NaN, so the caller can tell junk from an empty field.
 * @param {string|number|null|undefined} x
 * @returns {number|null}
 */
export function parseDecimal(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : NaN;
  const s = String(x).trim();
  if (s === '') return null;
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return NaN;
  return Number(s.replace(',', '.'));
}

/** A number written into an input field, with all its decimals and the language's separator: 0.62 → "0,62" (it). */
export function numText(x) {
  if (x === null || x === undefined || x === '') return '';
  const s = String(x);
  return lang === 'it' ? s.replace('.', ',') : s;
}

/** Keys that exist in English but not in Italian (for the test). */
export function missingKeys(target = 'it') {
  return Object.keys(EN).filter((k) => !(k in DICTS[target]));
}

// ---- browser side ----

/** Load the saved language (or pick one) and make it current. Safe without storage. */
export function loadLang() {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* storage blocked */ }
  setLang(initialLang(saved, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]));
  return lang;
}

export function saveLang(l) {
  setLang(l);
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* not remembered */ }
}

/** Put the current language's words into the page. */
export function applyStatic(root = document) {
  if (root.documentElement) root.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', t(el.dataset.i18nTitle)); });
}
