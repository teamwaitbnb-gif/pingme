// Reads Indian bank / card / UPI transaction SMS (and alert e-mails) into a transaction:
// { amount, dir: 'debit'|'credit', merchant, account, bank, ref, at, balance, mode }.
// Anything that isn't a completed transaction — OTPs, promotions, "will be debited", bill
// reminders, failed/declined payments — returns null and is never stored.

const BANKS = [
  ['SBI', /\b(sbi|state bank|sbiinb|sbipsg|sbmsms|cbssbi|atmsbi)\b/i], ['HDFC Bank', /\bhdfc/i], ['ICICI Bank', /\bicici/i],
  ['Axis Bank', /\baxis/i], ['Kotak', /\bkotak|kmbl/i], ['PNB', /\bpnb|punjab national/i], ['Bank of Baroda', /\bbob\b|bank of baroda|baroda/i],
  ['Canara Bank', /\bcanara|canbnk/i], ['Union Bank', /\bunion bank|ubin|unionb/i], ['IDFC First', /\bidfc/i], ['Yes Bank', /\byes ?bank|yesbnk/i],
  ['IndusInd', /\bindusind|indus/i], ['Federal Bank', /\bfederal/i], ['Bank of India', /\bbank of india|boiind/i], ['Indian Bank', /\bindian bank|indbnk/i],
  ['AU Bank', /\bau ?(small finance|bank)|aubank/i], ['RBL Bank', /\brbl/i], ['IDBI', /\bidbi/i], ['Paytm Payments Bank', /\bpaytm/i],
  ['Airtel Payments Bank', /\bairtel pay/i], ['Jupiter', /\bjupiter/i], ['Fi', /\bfi money|federal.*fi\b/i], ['Slice', /\bslice/i],
  ['OneCard', /\bonecard/i], ['Amex', /\bamex|american express/i], ['Citi', /\bciti/i], ['HSBC', /\bhsbc/i], ['Standard Chartered', /\bstandard chartered|stanc/i],
];

const NOT_TXN = [
  /\botp\b|one[\s-]?time password|verification code|do not share|never share/i,
  /\bwill be (debited|deducted|charged)|is due|due (on|by|date)|payment due|min(imum)? (amt|amount) due|bill (is )?generated|statement (is )?generated/i,
  /\b(failed|declined|unsuccessful|reversed? ?failed|could not be|has been blocked|insufficient)\b/i,
  /\b(offer|cashback up to|win|congrats|congratulations|apply now|pre-?approved|loan of up to|limit (has been )?(increased|enhanced)|click here to|kyc)\b/i,
  /\brequest(ed)? (money|payment)|has requested|collect request|mandate (created|registered)|autopay (set ?up|registered)/i,
];

const num = (s) => Number(String(s).replace(/,/g, ''));
const AMT = /(?:rs\.?|inr|₹|mrp)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

function parseDate(t, now = Date.now()) {
  let m = /\b(\d{1,2})[-\/ .]?([a-z]{3,4})[-\/ .,]*(\d{2,4})\b/i.exec(t);
  if (m && MONTHS[m[2].toLowerCase()] != null) return mk(+m[1], MONTHS[m[2].toLowerCase()], +m[3]);
  m = /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/.exec(t);
  if (m) return mk(+m[1], +m[2] - 1, +m[3]);
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return mk(+m[3], +m[2] - 1, +m[1]);
  return null;
  function mk(d, mo, y) {
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 0 || mo > 11) return null;
    const time = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\b/i.exec(t);
    let hh = 12, mm = 0;
    if (time) { hh = +time[1] % 24; mm = +time[2]; if (time[3]?.toLowerCase() === 'pm' && hh < 12) hh += 12; if (time[3]?.toLowerCase() === 'am' && hh === 12) hh = 0; }
    // Indian time → UTC
    const at = Date.UTC(y, mo, d, hh, mm) - 5.5 * 3600e3;
    return at > now + 2 * 86400e3 || at < now - 400 * 86400e3 ? null : at;
  }
}

const tidy = (s) => String(s || '')
  .replace(/\s+/g, ' ').replace(/^[\s:\-.,/]+|[\s:\-.,/]+$/g, '')
  .replace(/\b(on|via|ref(erence)?|upi|txn|avl|avbl|bal|info|dated?|at|from|to)\s*$/i, '').trim();

function merchantOf(t) {
  const pats = [
    /UPI\/(?:P2[AM]\/)?\d{6,}\/([A-Za-z][^\/\n]{1,40})/i,                 // UPI/P2M/123456/NAME/...
    /(?:VPA|UPI ID)\s*:?\s*[\w.\-]+@[\w]+\s*\(([^)]{2,40})\)/i,          // VPA x@ybl (NAME)
    /\bto\s+VPA\s+([\w.\-]+@[\w]+)/i,
    /\b(?:at|@)\s+([A-Za-z0-9][A-Za-z0-9 &'.\-*]{1,40}?)(?=\s+(?:on|via|using|for|ref|txn|avl|avbl|\.|,)|[.,]|\s*$)/i,
    /\b(?:spent|used|purchase[sd]?)\b.*?\bon\s+(?!\d)([A-Za-z][A-Za-z0-9 &'.\-*]{2,40}?)(?=[.,]|\s+(?:avl|avbl|ref|txn)|\s*$)/i, // ICICI: "spent … on AMAZON PAY IN." 
    /\b(?:paid to|sent to|transferred to|trf to|transfer to|to)\s+([A-Za-z][A-Za-z0-9 &'.\-]{1,40}?)(?=\s+(?:on|via|using|ref|upi|txn|a\/c|avl|\.|,)|[.,]|\s*$)/i,
    /\b(?:from|by)\s+([A-Za-z][A-Za-z0-9 &'.\-]{1,40}?)(?=\s+(?:on|via|ref|upi|txn|a\/c|avl|\.|,)|[.,]|\s*$)/i,
    /\btowards\s+([A-Za-z][A-Za-z0-9 &'.\-]{1,40}?)(?=[.,]|\s+(?:on|ref)|\s*$)/i,
    /\binfo\s*:?\s*([A-Za-z][A-Za-z0-9 &'.\-\/]{1,40})/i,
    /\b([\w.\-]+@(?:ybl|okaxis|okhdfcbank|okicici|oksbi|paytm|upi|apl|ibl|axl|icici|sbi|hdfcbank|axisbank|kotak|yesbank|fbl|idfcbank|jupiteraxis|freecharge|airtel))\b/i,
  ];
  for (const p of pats) {
    const m = p.exec(t);
    if (!m) continue;
    let s = tidy(m[1]);
    if (/@/.test(s)) s = s.split('@')[0].replace(/[._\-]?\d{4,}$/, '').replace(/[._\-]/g, ' ');
    s = s.replace(/\b(a\/c|acct|account|card|xx+\d*|\*+\d*)\b.*$/i, '').trim();
    s = s.replace(/^(?:neft|imps|rtgs|upi|ach|nach|mmt)\b[\s:\-\/]*(?:from|to|by|cr|dr)?\s*/i, '').trim(); // "NEFT from ACME" → "ACME" 
    if (s.length >= 2 && !/^(your|the|a|an|ac|a\/c|account|card|rs|inr|upi|net ?banking|imps|neft|rtgs|self|bank|atm)$/i.test(s) && !/^\d+$/.test(s)) return s.slice(0, 40);
  }
  return null;
}

function parseSms(text, { from = '', now = Date.now() } = {}) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 15 || t.length > 1200) return null;
  if (NOT_TXN.some((r) => r.test(t))) return null;
  // "Rs 450" / "INR 450" / "₹450" — or SBI-style "debited by 1200.0" with no currency word.
  const am = AMT.exec(t) || /\b(?:debited|credited|withdrawn|spent|paid|sent|deducted)\s+(?:by|with|for|of)?\s*([\d,]+(?:\.\d{1,2})?)\b/i.exec(t);
  if (!am) return null;
  const amount = num(am[1]);
  if (!(amount > 0) || amount > 1e9) return null;
  const low = t.toLowerCase();
  const isDebit = /\b(debited|debit(ed)? (by|with|for)|spent|paid|sent|withdrawn|withdrawal|purchase(d)?|deducted|charged|txn of|transaction of|used (at|for)|dr\b|is debited|has been debited|you've paid|payment of .* (made|successful)|transferred)\b/i.test(low);
  const isCredit = /\b(credited|received|deposited|refund(ed)?|reversed|cashback|cr\b|credit(ed)? (to|in)|has been credited|added to)\b/i.test(low);
  if (!isDebit && !isCredit) return null;
  // "debited … credited to X" (UPI sends) are debits; "credited … from X" are credits.
  let dir = isDebit && isCredit ? (low.indexOf('debit') !== -1 && (low.indexOf('debit') < low.indexOf('credit') || low.indexOf('credit') === -1) ? 'debit' : /\bsent|paid|spent|withdrawn/.test(low) ? 'debit' : 'credit') : isDebit ? 'debit' : 'credit';
  if (/\breversed|refund|cashback/.test(low)) dir = 'credit';
  const acct = /(?:a\/c|acct|account|ac|card|cc)\s*(?:no\.?\s*)?(?:ending\s*(?:with|in)?\s*)?[x*Xx.\s]*(\d{3,6})\b/i.exec(t);
  const bank = (BANKS.find(([, re]) => re.test(from)) || BANKS.find(([, re]) => re.test(t)) || [null])[0];
  const ref = (/\b(?:ref(?:erence)?|rrn|utr|txn ?id|upi ref|imps ref)\s*(?:no\.?|number|#|:)?\s*:?\s*([A-Z0-9]{6,22})/i.exec(t) || [])[1] || null;
  const bal = /(?:avl|avbl|available|a\/c|clear)\.?\s*(?:bal(?:ance)?|lmt|limit)\.?\s*(?:is|:)?\s*(?:rs\.?|inr|₹)\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i.exec(t);
  const mode = /\bupi\b/i.test(t) ? 'UPI' : /\b(credit card|cc\b|card ending|card no|card xx)/i.test(t) ? 'Card' : /\b(debit card|dc\b|pos\b)/i.test(t) ? 'Debit card' : /\b(atm|cash withdrawal|withdrawn)\b/i.test(t) ? 'ATM' : /\b(neft|imps|rtgs)\b/i.test(t) ? (/\b(neft|imps|rtgs)\b/i.exec(t)[1].toUpperCase()) : /\bach|nach|ecs|si\b|standing instruction|autopay|e-?mandate/i.test(t) ? 'Auto-debit' : null;
  let merchant = merchantOf(t);
  if (!merchant && mode === 'ATM') merchant = 'ATM cash';
  return { amount, dir, merchant, account: acct ? acct[1] : null, bank, ref, at: parseDate(t, now) || now, balance: bal ? num(bal[1]) : null, mode };
}

// ───── categories ─────
const CATEGORIES = ['Food & dining', 'Groceries', 'Shopping', 'Travel', 'Fuel', 'Bills & recharges', 'Rent', 'EMI & loans', 'Entertainment', 'Health', 'Education', 'Investments', 'Insurance', 'Transfers', 'Cash', 'Income', 'Other'];
const RULES = [
  ['Food & dining', /swiggy|zomato|eatsure|domino|pizza|mcdonald|kfc|burger|starbucks|cafe|coffee|restaurant|dhaba|biryani|chai|bakery|food|eat|dine|kitchen|haldiram|subway|baskin|barbeque|bbq/i],
  ['Groceries', /bigbasket|blinkit|zepto|instamart|dmart|d-mart|jiomart|more retail|reliance fresh|grofers|nature'?s basket|grocery|supermarket|kirana|milkbasket|country delight|spencer|ratnadeep|vijetha/i],
  ['Shopping', /amazon|flipkart|myntra|ajio|meesho|nykaa|tata ?cliq|snapdeal|lenskart|decathlon|ikea|croma|reliance digital|shoppers stop|lifestyle|westside|zara|h&m|uniqlo|pantaloons|max fashion|mall|store|mart\b/i],
  ['Travel', /uber|ola\b|olacabs|rapido|irctc|redbus|makemytrip|goibibo|cleartrip|yatra|ixigo|indigo|air india|vistara|akasa|spicejet|metro|fastag|toll|parking|airport|railway|abhibus|blablacar|namma yatri/i],
  ['Fuel', /petrol|diesel|fuel|hpcl|bpcl|iocl|indian oil|bharat petroleum|hindustan petroleum|shell|nayara|essar oil|hp pay/i],
  ['Bills & recharges', /airtel|jio|vodafone|\bvi\b|bsnl|recharge|electricity|bescom|tsspdcl|tsnpdcl|apspdcl|msedcl|tneb|bses|tata power|adani electricity|water|gas|mahanagar gas|indane|hp gas|bharat gas|broadband|act fibernet|hathway|dth|tata ?play|dish ?tv|sun direct|bill ?desk|billpay|postpaid|municipal|property tax/i],
  ['Rent', /\brent\b|nobroker|nestaway|housing\.com|landlord|pg rent|hostel/i],
  ['EMI & loans', /\bemi\b|loan|bajaj fin|home credit|tvs credit|hdb fin|capital first|kreditbee|moneyview|lazypay|simpl|slice|cred.*bill|credit card (bill|payment)|card payment|ach d|nach/i],
  ['Entertainment', /netflix|prime video|hotstar|jiocinema|jiohotstar|sonyliv|zee5|spotify|gaana|wynk|youtube premium|bookmyshow|pvr|inox|cinepolis|district|steam|playstation|xbox|google play|app store|apple\.com|dream11|my11circle|mpl|games?\b/i],
  ['Health', /pharmacy|medplus|apollo|1mg|netmeds|pharmeasy|practo|hospital|clinic|diagnostic|lab\b|thyrocare|dr\.? lal|medical|chemist|cult\.?fit|gym|healthify/i],
  ['Education', /school|college|university|tuition|coaching|byju|unacademy|vedantu|udemy|coursera|upgrad|physics ?wallah|fees|exam|books?\b/i],
  ['Investments', /zerodha|groww|upstox|kuvera|coin by|smallcase|mutual fund|\bmf\b|sip\b|nps|ppf|angel ?one|5paisa|indmoney|paytm money|icici direct|hdfc sec|motilal|stocks?|demat|gold|digital gold|fixed deposit|\bfd\b|\brd\b/i],
  ['Insurance', /insurance|policy ?bazaar|lic\b|hdfc life|icici pru|sbi life|max life|tata aia|star health|niva bupa|care health|acko|digit insurance|premium/i],
  ['Cash', /\batm\b|cash withdrawal|atm cash/i],
];
// A person (UPI to someone's name) rather than a shop → Transfers.
const looksLikePerson = (m) => /^[A-Z][a-z]+(?: [A-Z][a-z]*\.?){0,3}$/.test(m) || /^[A-Z]+(?: [A-Z]+){1,3}$/.test(m) && !/\b(PVT|LTD|LIMITED|STORE|MART|ENTERPRISES?|TRADERS|SERVICES|FOODS?|CAFE|RESTAURANT|HOTEL|MEDICAL|PHARMA|AGENC(Y|IES))\b/.test(m);

function categorize(tx, learned = {}) {
  const m = (tx.merchant || '').trim();
  const key = m.toLowerCase();
  if (key && learned[key]) return learned[key];
  if (tx.dir === 'credit') return /refund|reversed|cashback/i.test(m) ? 'Other' : 'Income';
  if (tx.mode === 'ATM') return 'Cash';
  for (const [cat, re] of RULES) if (re.test(m)) return cat;
  if (tx.mode === 'Auto-debit') return 'EMI & loans';
  if (m && looksLikePerson(m)) return 'Transfers';
  return 'Other';
}

module.exports = { parseSms, categorize, CATEGORIES, merchantOf };
