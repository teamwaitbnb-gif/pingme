const test = require('node:test');
const assert = require('node:assert');
const { parseSms, categorize } = require('../server/money-parse');

const NOW = Date.UTC(2026, 9, 22, 6, 0); // 22 Oct 2026, 11:30 IST
const p = (t, from) => parseSms(t, { from, now: NOW });

test('HDFC UPI debit with VPA and name', () => {
  const t = p('Sent Rs.450.00 From HDFC Bank A/C x1234 To SWIGGY On 21/10/26 Ref 629812345678 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808');
  assert.equal(t.amount, 450); assert.equal(t.dir, 'debit'); assert.equal(t.account, '1234'); assert.equal(t.bank, 'HDFC Bank');
  assert.match(t.merchant, /swiggy/i); assert.equal(t.mode, null === t.mode ? null : t.mode);
  assert.equal(categorize(t), 'Food & dining');
});

test('SBI UPI debit "trf to"', () => {
  const t = p('Dear UPI user A/C X5678 debited by 1200.0 on date 20Oct26 trf to RAMESH KUMAR Refno 629311112222. If not u? call 1800111109. -SBI', 'VM-SBIUPI');
  assert.equal(t.amount, 1200); assert.equal(t.dir, 'debit'); assert.equal(t.bank, 'SBI'); assert.equal(t.merchant, 'RAMESH KUMAR');
  assert.equal(categorize(t), 'Transfers');
});

test('ICICI credit card spend at merchant', () => {
  const t = p('INR 2,349.00 spent using ICICI Bank Card XX9012 on 19-Oct-26 on AMAZON PAY IN. Avl Limit: INR 1,20,000.00. If not you, call 1800 2662/SMS BLOCK 9012 to 9215676766.');
  assert.equal(t.amount, 2349); assert.equal(t.dir, 'debit'); assert.equal(t.account, '9012'); assert.equal(t.bank, 'ICICI Bank');
  assert.equal(t.merchant, 'AMAZON PAY IN');
  assert.equal(categorize(t), 'Shopping');
});

test('Axis debit card at merchant with "at"', () => {
  const t = p('Spent INR 820 Axis Bank Card no. XX4321 18-10-26 20:14:33 at UBER INDIA SYSTEM Avl Lmt INR 45,000 SMS BLOCKCARD 4321 to 919951860002');
  assert.equal(t.amount, 820); assert.match(t.merchant, /uber/i); assert.equal(categorize(t), 'Travel');
});

test('Salary credit', () => {
  const t = p('Rs 85,000.00 credited to a/c XXXXXX3456 on 01-10-26 by NEFT from ACME TECHNOLOGIES PVT LTD. Avl bal Rs 1,02,340.55 - Kotak Bank');
  assert.equal(t.merchant, 'ACME TECHNOLOGIES PVT LTD');
  assert.equal(t.amount, 85000); assert.equal(t.dir, 'credit'); assert.equal(t.balance, 102340.55); assert.equal(t.bank, 'Kotak');
  assert.equal(categorize(t), 'Income');
});

test('ATM withdrawal', () => {
  const t = p('Rs.2000 withdrawn at ATM from A/c XX7788 on 17-Oct-26. Avl Bal Rs.5,421.00 -PNB');
  assert.equal(t.dir, 'debit'); assert.equal(t.mode, 'ATM'); assert.equal(categorize(t), 'Cash');
});

test('Refund is a credit', () => {
  const t = p('Refund of Rs. 599.00 from FLIPKART has been credited to your HDFC Bank Credit Card ending 1111 on 15-10-2026.');
  assert.equal(t.dir, 'credit'); assert.equal(t.amount, 599);
});

test('UPI P2M via info string', () => {
  const t = p('Your a/c no. XXXXXXXX2468 is debited for Rs.150.00 on 21-10-2026 and credited to a/c no. XXXXXXXX0001 (UPI Ref no 629901234567). Info: UPI/P2M/629901234567/ZEPTO MARKETPLACE');
  assert.equal(t.dir, 'debit'); assert.equal(t.amount, 150); assert.match(t.merchant, /zepto/i); assert.equal(categorize(t), 'Groceries');
});

test('Not transactions: OTP, due reminder, promo, failed, future debit', () => {
  assert.equal(p('123456 is your OTP for txn of Rs 500 at AMAZON. Do not share with anyone.'), null);
  assert.equal(p('Your credit card bill of Rs. 12,345 is due on 25-10-2026. Pay now to avoid charges.'), null);
  assert.equal(p('Congrats! You are pre-approved for a loan of up to Rs 5,00,000. Apply now.'), null);
  assert.equal(p('Transaction of Rs 300 at ZOMATO failed due to insufficient balance.'), null);
  assert.equal(p('Rs 999 will be debited from your account on 28-10-2026 for NETFLIX autopay.'), null);
  assert.equal(p('Hey are we meeting for dinner at 8?'), null);
});

test('Learned category for a merchant wins', () => {
  const t = p('Sent Rs.300.00 From HDFC Bank A/C x1234 To RAJU TEA STALL On 21/10/26 Ref 629812349999');
  assert.equal(categorize(t, { 'raju tea stall': 'Food & dining' }), 'Food & dining');
});

test('Date from the SMS (IST) is used', () => {
  const t = p('Rs.250 debited from A/c XX1234 on 05-10-26 at 19:30 to BLINKIT. Ref 123456789012');
  assert.equal(new Date(t.at + 5.5 * 3600e3).toISOString().slice(0, 16), '2026-10-05T19:30');
});
