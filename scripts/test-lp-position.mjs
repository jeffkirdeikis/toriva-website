// One-off verifier: reads NFT 4804594 via the same logic as api/pool-fees.js
// and prints principal + fees so we can compare against the Uniswap UI.
//
// Run: node scripts/test-lp-position.mjs

const POOL_ADDR = '0x2393cf60fd67e58e302f6d0b8c552cd5c37caf97';
const NPM_ADDR = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const LP_TOKEN_ID = 4804594n;
const RPCS = [
  'https://mainnet.base.org',
  'https://base-mainnet.public.blastapi.io',
  'https://base.llamarpc.com',
];
const Q96 = 1n << 96n;
const Q128 = 1n << 128n;
const MAX256 = 1n << 256n;

const sub256 = (a, b) => ((a - b) % MAX256 + MAX256) % MAX256;
const decodeWord = (hex, idx) => BigInt('0x' + hex.slice(2 + idx * 64, 2 + (idx + 1) * 64));
const decodeInt24 = (w) => (w >= (1n << 255n) ? Number(w - MAX256) : Number(w));
const encodeUint = (v) => BigInt(v).toString(16).padStart(64, '0');
const encodeInt24 = (v) => {
  let bn = BigInt(v);
  if (bn < 0n) bn = MAX256 + bn;
  return bn.toString(16).padStart(64, '0');
};

async function rawCall(to, data) {
  let lastErr;
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', id: 1, params: [{ to, data }, 'latest'] }),
      });
      const j = await r.json();
      if (j.error) { lastErr = j.error; continue; }
      if (!j.result || j.result === '0x') { lastErr = 'empty'; continue; }
      return j.result;
    } catch (e) { lastErr = e.message; continue; }
  }
  throw new Error('All RPCs failed: ' + JSON.stringify(lastErr));
}

const torivaPrice = 1 / 514.385; // from screenshot

const posResult = await rawCall(NPM_ADDR, '0x99fbab88' + encodeUint(LP_TOKEN_ID));
const tickLower = decodeInt24(decodeWord(posResult, 5));
const tickUpper = decodeInt24(decodeWord(posResult, 6));
const liquidity = decodeWord(posResult, 7);
const fgInside0Last = decodeWord(posResult, 8);
const fgInside1Last = decodeWord(posResult, 9);
const tokensOwed0 = decodeWord(posResult, 10);
const tokensOwed1 = decodeWord(posResult, 11);

const [slot0, fg0Hex, fg1Hex, tickL, tickU] = await Promise.all([
  rawCall(POOL_ADDR, '0x3850c7bd'),
  rawCall(POOL_ADDR, '0xf3058399'),
  rawCall(POOL_ADDR, '0x46141319'),
  rawCall(POOL_ADDR, '0xf30dba93' + encodeInt24(tickLower)),
  rawCall(POOL_ADDR, '0xf30dba93' + encodeInt24(tickUpper)),
]);

const sqrtPriceX96 = decodeWord(slot0, 0);
const currentTick = decodeInt24(decodeWord(slot0, 1));
const fg0 = BigInt(fg0Hex);
const fg1 = BigInt(fg1Hex);

const fgOL0 = decodeWord(tickL, 2), fgOL1 = decodeWord(tickL, 3);
const fgOU0 = decodeWord(tickU, 2), fgOU1 = decodeWord(tickU, 3);

const feeGrowthInside = (fg, low, up) => {
  const below = currentTick >= tickLower ? low : sub256(fg, low);
  const above = currentTick < tickUpper ? up : sub256(fg, up);
  return sub256(sub256(fg, below), above);
};

const fgIn0 = feeGrowthInside(fg0, fgOL0, fgOU0);
const fgIn1 = feeGrowthInside(fg1, fgOL1, fgOU1);

const owed0 = tokensOwed0 + sub256(fgIn0, fgInside0Last) * liquidity / Q128;
const owed1 = tokensOwed1 + sub256(fgIn1, fgInside1Last) * liquidity / Q128;

const sqrtP = Number(sqrtPriceX96) / Number(Q96);
const sqrtPLower = Math.pow(1.0001, tickLower / 2);
const sqrtPUpper = Math.pow(1.0001, tickUpper / 2);
const L = Number(liquidity);

let a0 = 0, a1 = 0;
if (currentTick < tickLower) a0 = L * (sqrtPUpper - sqrtPLower) / (sqrtPLower * sqrtPUpper);
else if (currentTick >= tickUpper) a1 = L * (sqrtPUpper - sqrtPLower);
else { a0 = L * (sqrtPUpper - sqrtP) / (sqrtP * sqrtPUpper); a1 = L * (sqrtP - sqrtPLower); }

const principalUsdc = a0 / 1e6;
const principalToriva = a1 / 1e18;
const principalTorivaUSD = principalToriva * torivaPrice;
const feesUsdc = Number(owed0) / 1e6;
const feesToriva = Number(owed1) / 1e18;
const feesTorivaUSD = feesToriva * torivaPrice;

console.log('TICKS', { tickLower, tickUpper, currentTick, inRange: currentTick >= tickLower && currentTick < tickUpper });
console.log('LIQUIDITY', liquidity.toString());
console.log('PRINCIPAL', {
  usdc: principalUsdc.toFixed(2),
  toriva: (principalToriva / 1e6).toFixed(2) + 'M',
  torivaUSD: principalTorivaUSD.toFixed(2),
  total: (principalUsdc + principalTorivaUSD).toFixed(2),
});
console.log('FEES', {
  usdc: feesUsdc.toFixed(2),
  toriva: (feesToriva / 1e6).toFixed(2) + 'M',
  torivaUSD: feesTorivaUSD.toFixed(2),
  total: (feesUsdc + feesTorivaUSD).toFixed(2),
});
console.log('SCREENSHOT EXPECTED  Principal: $336,402.74 ($109,548.85 USDC + 116.70M TORIVA)');
console.log('SCREENSHOT EXPECTED  Fees:      $30,002.64  ($16,419.98 USDC + 6.99M TORIVA)');
