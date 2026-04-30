import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const POOL_ADDR = '0x2393cf60fd67e58e302f6d0b8c552cd5c37caf97';
const GECKO_URL = 'https://api.geckoterminal.com/api/v2/networks/base/pools/' + POOL_ADDR;
const RPC_ENDPOINTS = [
  'https://base.llamarpc.com',
  'https://base-mainnet.public.blastapi.io',
  'https://mainnet.base.org',
];
const FEE_RATE = 0.01;
const Q96 = BigInt(2) ** BigInt(96);
const Q128 = BigInt(2) ** BigInt(128);
const MAX256 = BigInt(2) ** BigInt(256);
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // Save snapshot every 5 minutes

const USDC_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TORIVA_ADDR = '0xb886Cf1444BFF05e9a99E00543BC4054d423ebFD';
const TREASURY_WALLETS = [
  '0x2633148755A12c6D5aBD75Eed90B4a6572275Cdb',
  '0xC100ADC1D10a75559ee473bC05fbad582c375869',
  '0xF56b733bEEd82C033c5d6fD000A6834C5D1e0d4E',
];
const NPM_ADDR = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const LP_TOKEN_ID = BigInt(4804594);

// Module-level caches survive between Vercel function invocations on the
// same warm instance, so we don't re-hit the chain on every request.
const CHAIN_TTL_MS = 60 * 1000;
const STRIPE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — Stripe public profile only updates ~1x/day
let _lpCache = null;     // { raw, ts }
let _walletCache = null; // { raw, ts }
let _stripeCache = null; // { value, ts }

const STRIPE_METRIC_URL = 'https://api.stripe.com/v2/xauth_/shareable_metrics/runmybiz/SeF3oviO';

// Hardcoded last-resort fallback so the dashboard never shows "--" for ARR
// even if Stripe is fully down on a cold start. Refreshed in code as needed.
const STRIPE_FALLBACK = {
  arrCAD: 10506.72,
  mrrCAD: 875.56,
  asOf: '2026-04-29',
  currency: 'CAD',
  chartPoints: [],
};

async function getRmbArr() {
  if (_stripeCache && Date.now() - _stripeCache.ts < STRIPE_TTL_MS) {
    return _stripeCache.value;
  }
  try {
    const r = await fetch(STRIPE_METRIC_URL, {
      headers: {
        'stripe-version': 'unsafe-development',
        'referer': 'https://profile.stripe.com/',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!r.ok) throw new Error('stripe ' + r.status);
    const data = await r.json();
    const series = JSON.parse(data.metric_data || '[]');
    if (!series.length) throw new Error('empty series');
    const latest = series[series.length - 1];
    const mrrCAD = (Number(latest.total) || 0) / 100;
    const value = {
      arrCAD: mrrCAD * 12,
      mrrCAD,
      asOf: latest.start_time, // YYYY-MM-DD
      currency: 'CAD',
      chartPoints: series.map(p => ({
        date: p.start_time,
        arrCAD: (Number(p.total) || 0) * 12 / 100,
      })),
    };
    _stripeCache = { value, ts: Date.now() };
    return value;
  } catch (e) {
    console.error('Stripe ARR fetch failed:', e.message);
    return _stripeCache ? _stripeCache.value : STRIPE_FALLBACK;
  }
}

const RPC_TIMEOUT_MS = 3500;

async function rawCall(contractAddr, data) {
  for (const rpc of RPC_ENDPOINTS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', method: 'eth_call', id: 1,
          params: [{ to: contractAddr, data }, 'latest']
        }),
        signal: ctl.signal,
      });
      if (!res.ok) continue;
      const { result, error } = await res.json();
      if (error || !result || result === '0x') continue;
      return result;
    } catch (e) {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('All RPCs failed for contract ' + contractAddr);
}

async function readContract(contractAddr, data) {
  return BigInt(await rawCall(contractAddr, data));
}

async function readPool(selector) {
  return readContract(POOL_ADDR, selector);
}

function balanceOfData(address) {
  return '0x70a08231000000000000000000000000' + address.slice(2).toLowerCase();
}

function decodeWord(hexResult, idx) {
  const start = 2 + idx * 64;
  return BigInt('0x' + hexResult.slice(start, start + 64));
}

function decodeInt24Word(word) {
  // word is BigInt sign-extended to 256 bits; convert back to signed int24
  return word >= (BigInt(1) << BigInt(255)) ? Number(word - MAX256) : Number(word);
}

function encodeUint(v) {
  return BigInt(v).toString(16).padStart(64, '0');
}

function encodeInt24(v) {
  let bn = BigInt(v);
  if (bn < 0n) bn = MAX256 + bn;
  return bn.toString(16).padStart(64, '0');
}

function sub256(a, b) {
  return ((a - b) % MAX256 + MAX256) % MAX256;
}

// Read live treasury wallet token balances. Cached in-memory for CHAIN_TTL_MS;
// falls back to last-known-good if RPCs fail (price-derived fields recomputed).
async function getWalletBalances(torivaPrice) {
  if (_walletCache && Date.now() - _walletCache.ts < CHAIN_TTL_MS) {
    return deriveWalletPrice(_walletCache.raw, torivaPrice);
  }
  try {
    const calls = TREASURY_WALLETS.flatMap(w => [
      readContract(USDC_ADDR, balanceOfData(w)),
      readContract(TORIVA_ADDR, balanceOfData(w)),
    ]);
    const results = await Promise.all(calls);
    let usdcTotal = 0n, torivaTotal = 0n;
    for (let i = 0; i < TREASURY_WALLETS.length; i++) {
      usdcTotal += results[i * 2];
      torivaTotal += results[i * 2 + 1];
    }
    const raw = {
      walletUsdc: Number(usdcTotal) / 1e6,
      walletToriva: Number(torivaTotal) / 1e18,
    };
    _walletCache = { raw, ts: Date.now() };
    return deriveWalletPrice(raw, torivaPrice);
  } catch (e) {
    console.error('Wallet balance fetch failed:', e.message);
    return _walletCache ? deriveWalletPrice(_walletCache.raw, torivaPrice) : null;
  }
}

function deriveWalletPrice(raw, torivaPrice) {
  return {
    walletUsdc: raw.walletUsdc,
    walletToriva: raw.walletToriva,
    walletTorivaUSD: raw.walletToriva * torivaPrice,
  };
}

// Read the project's specific LP NFT position (principal + unclaimed fees).
// Cached in-memory for CHAIN_TTL_MS; falls back to last-known-good on failure.
async function getLpPosition(torivaPrice) {
  if (_lpCache && Date.now() - _lpCache.ts < CHAIN_TTL_MS) {
    return deriveLpPrice(_lpCache.raw, torivaPrice);
  }
  try {
    const posResult = await rawCall(NPM_ADDR, '0x99fbab88' + encodeUint(LP_TOKEN_ID));

    // positions() return layout (slot indices):
    // 0:nonce 1:operator 2:token0 3:token1 4:fee
    // 5:tickLower(int24) 6:tickUpper(int24) 7:liquidity(uint128)
    // 8:feeGrowthInside0LastX128 9:feeGrowthInside1LastX128
    // 10:tokensOwed0(uint128) 11:tokensOwed1(uint128)
    const tickLower = decodeInt24Word(decodeWord(posResult, 5));
    const tickUpper = decodeInt24Word(decodeWord(posResult, 6));
    const liquidity = decodeWord(posResult, 7);
    const fgInside0Last = decodeWord(posResult, 8);
    const fgInside1Last = decodeWord(posResult, 9);
    const tokensOwed0 = decodeWord(posResult, 10);
    const tokensOwed1 = decodeWord(posResult, 11);

    const [slot0Result, fg0, fg1, tickLowerResult, tickUpperResult] = await Promise.all([
      rawCall(POOL_ADDR, '0x3850c7bd'),
      readPool('0xf3058399'),
      readPool('0x46141319'),
      rawCall(POOL_ADDR, '0xf30dba93' + encodeInt24(tickLower)),
      rawCall(POOL_ADDR, '0xf30dba93' + encodeInt24(tickUpper)),
    ]);

    const sqrtPriceX96 = decodeWord(slot0Result, 0);
    const currentTick = decodeInt24Word(decodeWord(slot0Result, 1));

    // ticks() return: 0:liquidityGross 1:liquidityNet 2:fgOutside0 3:fgOutside1 ...
    const fgOutside0Lower = decodeWord(tickLowerResult, 2);
    const fgOutside1Lower = decodeWord(tickLowerResult, 3);
    const fgOutside0Upper = decodeWord(tickUpperResult, 2);
    const fgOutside1Upper = decodeWord(tickUpperResult, 3);

    const feeGrowthInside = (fgGlobal, fgOutLower, fgOutUpper) => {
      const below = currentTick >= tickLower ? fgOutLower : sub256(fgGlobal, fgOutLower);
      const above = currentTick < tickUpper ? fgOutUpper : sub256(fgGlobal, fgOutUpper);
      return sub256(sub256(fgGlobal, below), above);
    };

    const fgInside0 = feeGrowthInside(fg0, fgOutside0Lower, fgOutside0Upper);
    const fgInside1 = feeGrowthInside(fg1, fgOutside1Lower, fgOutside1Upper);

    const owed0 = tokensOwed0 + sub256(fgInside0, fgInside0Last) * liquidity / Q128;
    const owed1 = tokensOwed1 + sub256(fgInside1, fgInside1Last) * liquidity / Q128;

    const feesUsdc = Number(owed0) / 1e6;
    const feesToriva = Number(owed1) / 1e18;
    const feesTorivaUSD = feesToriva * torivaPrice;
    const feesTotal = feesUsdc + feesTorivaUSD;

    // Convert active liquidity to underlying token amounts (V3 math)
    const sqrtP = Number(sqrtPriceX96) / Number(Q96);
    const sqrtPLower = Math.pow(1.0001, tickLower / 2);
    const sqrtPUpper = Math.pow(1.0001, tickUpper / 2);
    const L = Number(liquidity);
    let amount0Raw = 0, amount1Raw = 0;
    if (currentTick < tickLower) {
      amount0Raw = L * (sqrtPUpper - sqrtPLower) / (sqrtPLower * sqrtPUpper);
    } else if (currentTick >= tickUpper) {
      amount1Raw = L * (sqrtPUpper - sqrtPLower);
    } else {
      amount0Raw = L * (sqrtPUpper - sqrtP) / (sqrtP * sqrtPUpper);
      amount1Raw = L * (sqrtP - sqrtPLower);
    }

    const principalUsdc = amount0Raw / 1e6;
    const principalToriva = amount1Raw / 1e18;

    const raw = {
      principalUsdc,
      principalToriva,
      feesUsdc,
      feesToriva,
      tickLower,
      tickUpper,
      currentTick,
    };
    _lpCache = { raw, ts: Date.now() };
    return deriveLpPrice(raw, torivaPrice);
  } catch (e) {
    console.error('LP position read failed:', e.message);
    return _lpCache ? deriveLpPrice(_lpCache.raw, torivaPrice) : null;
  }
}

function deriveLpPrice(raw, torivaPrice) {
  const principalTorivaUSD = raw.principalToriva * torivaPrice;
  const feesTorivaUSD = raw.feesToriva * torivaPrice;
  const feesTotal = raw.feesUsdc + feesTorivaUSD;
  return {
    principal: {
      usdc: raw.principalUsdc,
      toriva: raw.principalToriva,
      torivaUSD: principalTorivaUSD,
      total: raw.principalUsdc + principalTorivaUSD,
    },
    fees: {
      usdc: raw.feesUsdc,
      toriva: raw.feesToriva,
      torivaUSD: feesTorivaUSD,
      total: feesTotal,
      usdcRatio: feesTotal > 0 ? raw.feesUsdc / feesTotal : 0.5,
      torivaRatio: feesTotal > 0 ? feesTorivaUSD / feesTotal : 0.5,
    },
    tickLower: raw.tickLower,
    tickUpper: raw.tickUpper,
    currentTick: raw.currentTick,
    inRange: raw.currentTick >= raw.tickLower && raw.currentTick < raw.tickUpper,
  };
}

function splitFees(totalFeesUSD, usdcRatio, torivaRatio, torivaPrice) {
  var usdcFees = totalFeesUSD * usdcRatio;
  var torivaFeesUSD = totalFeesUSD * torivaRatio;
  var torivaFees = torivaPrice > 0 ? torivaFeesUSD / torivaPrice : 0;
  return { usdc: usdcFees, toriva: torivaFees, torivaUSD: torivaFeesUSD };
}

// Save a snapshot of cumulative fees (throttled to every 5 minutes)
async function saveSnapshot(usdcFees, torivaFees, torivaPrice) {
  try {
    // Check if we saved a snapshot recently
    const { data: recent } = await supabase
      .from('fee_snapshots')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);

    if (recent && recent.length > 0) {
      const lastTime = new Date(recent[0].created_at).getTime();
      if (Date.now() - lastTime < SNAPSHOT_INTERVAL_MS) return;
    }

    await supabase.from('fee_snapshots').insert({
      usdc_fees: usdcFees,
      toriva_fees: torivaFees,
      toriva_price: torivaPrice,
    });
  } catch (e) {
    console.error('Snapshot save failed:', e.message);
  }
}

// Get the snapshot closest to a given time ago, returns { usdc_fees, toriva_fees, toriva_price }
async function getSnapshotAt(hoursAgo) {
  try {
    const target = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
    // Get the snapshot closest to the target time (the one just before it)
    const { data } = await supabase
      .from('fee_snapshots')
      .select('usdc_fees, toriva_fees, toriva_price, created_at')
      .lte('created_at', target)
      .order('created_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0) return data[0];
    return null;
  } catch (e) {
    console.error('Snapshot lookup failed:', e.message);
    return null;
  }
}

// Compute fee delta between current cumulative and a historical snapshot.
// Returns null if the snapshot looks stale or pre-source-change (snapshot >
// current means it was recorded against pool-wide fees, not NFT fees), so
// callers fall back to volume-based estimates.
function computeDelta(cumulative, snapshot, currentPrice) {
  if (!snapshot) return null;
  const usdcDelta = cumulative.usdc - Number(snapshot.usdc_fees);
  const torivaDelta = cumulative.toriva - Number(snapshot.toriva_fees);
  if (usdcDelta < 0 || torivaDelta < 0) return null;
  return { usdc: usdcDelta, toriva: torivaDelta, torivaUSD: torivaDelta * currentPrice };
}

// Clean up snapshots older than 31 days
async function cleanOldSnapshots() {
  try {
    const cutoff = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    await supabase.from('fee_snapshots').delete().lt('created_at', cutoff);
  } catch (e) {
    // Non-critical, ignore
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Edge cache 60s with long SWR — if refresh hiccups, users still see
  // last-known-good while the next invocation retries.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const [poolRes, ohlcvRes] = await Promise.all([
      fetch(GECKO_URL, { headers: { Accept: 'application/json' } }),
      fetch(GECKO_URL + '/ohlcv/day?limit=365', { headers: { Accept: 'application/json' } }),
    ]);

    if (!poolRes.ok) {
      return res.status(502).json({ error: 'GeckoTerminal pool request failed' });
    }

    const poolData = await poolRes.json();
    const ohlcvData = ohlcvRes.ok ? await ohlcvRes.json() : null;

    const attr = poolData.data.attributes;
    const tvl = parseFloat(attr.reserve_in_usd) || 0;
    const torivaPrice = parseFloat(attr.base_token_price_usd) || 0;
    const txn = attr.transactions;

    const vol24h = parseFloat(attr.volume_usd.h24) || 0;
    const vol6h = parseFloat(attr.volume_usd.h6) || 0;
    const vol1h = parseFloat(attr.volume_usd.h1) || 0;

    // Read project's actual LP NFT, wallet balances, snapshots, and RMB ARR in parallel
    const [lpPos, wallet, rmbArr, snap1h, snap6h, snap24h, snap7d, snap30d] = await Promise.all([
      getLpPosition(torivaPrice),
      getWalletBalances(torivaPrice),
      getRmbArr(),
      getSnapshotAt(1),
      getSnapshotAt(6),
      getSnapshotAt(24),
      getSnapshotAt(24 * 7),
      getSnapshotAt(24 * 30),
    ]);

    // Cumulative fees = unclaimed fees on the project's LP NFT.
    // (Project hasn't called collect(); when they do, we'll need to track Collect events.)
    const cumulative = lpPos ? {
      usdc: lpPos.fees.usdc,
      toriva: lpPos.fees.toriva,
      torivaUSD: lpPos.fees.torivaUSD,
      total: lpPos.fees.total,
    } : null;

    // Snapshot the NFT's current fees for time-windowed deltas
    if (cumulative) {
      saveSnapshot(cumulative.usdc, cumulative.toriva, torivaPrice);
      cleanOldSnapshots();
    }

    const usdcRatio = lpPos ? lpPos.fees.usdcRatio : 0.5;
    const torivaRatio = lpPos ? lpPos.fees.torivaRatio : 0.5;

    const delta1h = cumulative ? computeDelta(cumulative, snap1h, torivaPrice) : null;
    const delta6h = cumulative ? computeDelta(cumulative, snap6h, torivaPrice) : null;
    const delta24h = cumulative ? computeDelta(cumulative, snap24h, torivaPrice) : null;
    const delta7d = cumulative ? computeDelta(cumulative, snap7d, torivaPrice) : null;
    const delta30d = cumulative ? computeDelta(cumulative, snap30d, torivaPrice) : null;

    // Volume-based fallback when no usable snapshot exists. Reflects the
    // project's share of the pool (NFT principal / total pool TVL).
    const lpShare = lpPos && tvl > 0 ? Math.min(1, lpPos.principal.total / tvl) : 1;
    const fallback = (vol) => {
      const fees = vol * FEE_RATE * lpShare;
      return splitFees(fees, usdcRatio, torivaRatio, torivaPrice);
    };

    const days = ohlcvData?.data?.attributes?.ohlcv_list || [];
    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    let vol7d = 0, vol30d = 0;
    for (const bar of days) {
      const ts = bar[0];
      const vol = bar[5] || 0;
      if (ts >= now - 7 * DAY) vol7d += vol;
      if (ts >= now - 30 * DAY) vol30d += vol;
    }

    const split = {
      '1h': delta1h || fallback(vol1h),
      '6h': delta6h || fallback(vol6h),
      '24h': delta24h || fallback(vol24h),
      '7d': delta7d || fallback(vol7d),
      '30d': delta30d || fallback(vol30d),
    };

    const feeTotal = (s) => s.usdc + s.torivaUSD;

    return res.status(200).json({
      pool: {
        pair: attr.pool_name || attr.name,
        fee: attr.pool_fee_percentage + '%',
        lpShare,
        tvl,
        torivaPrice,
        createdAt: attr.pool_created_at,
      },
      cumulative: cumulative || { usdc: 0, toriva: 0, torivaUSD: 0, total: 0 },
      fees: {
        '1h': feeTotal(split['1h']),
        '6h': feeTotal(split['6h']),
        '24h': feeTotal(split['24h']),
        '7d': feeTotal(split['7d']),
        '30d': feeTotal(split['30d']),
      },
      split,
      snapshotBased: {
        '1h': !!delta1h,
        '6h': !!delta6h,
        '24h': !!delta24h,
        '7d': !!delta7d,
        '30d': !!delta30d,
      },
      onChain: { usdcRatio, torivaRatio },
      volume: { '1h': vol1h, '6h': vol6h, '24h': vol24h, '7d': vol7d, '30d': vol30d },
      transactions: txn,
      rmbArr: rmbArr || null,
      treasury: {
        walletUsdc: wallet ? wallet.walletUsdc : 0,
        walletToriva: wallet ? wallet.walletToriva : 0,
        walletTorivaUSD: wallet ? wallet.walletTorivaUSD : 0,
        lpPosition: lpPos ? {
          usdc: lpPos.principal.usdc,
          toriva: lpPos.principal.toriva,
          torivaUSD: lpPos.principal.torivaUSD,
          total: lpPos.principal.total,
        } : null,
        lpRange: lpPos ? {
          tickLower: lpPos.tickLower,
          tickUpper: lpPos.tickUpper,
          currentTick: lpPos.currentTick,
          inRange: lpPos.inRange,
        } : null,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Pool fees error:', err);
    return res.status(500).json({ error: 'Failed to fetch pool data' });
  }
}
