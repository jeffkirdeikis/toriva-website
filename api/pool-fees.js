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
const TREASURY_WALLET = '0x2633148755A12c6D5aBD75Eed90B4a6572275Cdb';
const NPM_ADDR = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
const LP_TOKEN_ID = BigInt(4804594);

// Raw eth_call returning hex string with RPC fallback
async function rawCall(contractAddr, data) {
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', method: 'eth_call', id: 1,
          params: [{ to: contractAddr, data }, 'latest']
        })
      });
      if (!res.ok) continue;
      const { result, error } = await res.json();
      if (error || !result || result === '0x') continue;
      return result;
    } catch (e) {
      continue;
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

// Read live treasury wallet token balances
async function getWalletBalances(torivaPrice) {
  try {
    const [walletUsdc, walletToriva] = await Promise.all([
      readContract(USDC_ADDR, balanceOfData(TREASURY_WALLET)),
      readContract(TORIVA_ADDR, balanceOfData(TREASURY_WALLET)),
    ]);
    const walletUsdcNum = Number(walletUsdc) / 1e6;
    const walletTorivaNum = Number(walletToriva) / 1e18;
    return {
      walletUsdc: walletUsdcNum,
      walletToriva: walletTorivaNum,
      walletTorivaUSD: walletTorivaNum * torivaPrice,
    };
  } catch (e) {
    console.error('Wallet balance fetch failed:', e.message);
    return null;
  }
}

// Read the project's specific LP NFT position (principal + unclaimed fees).
// Replaces the old whole-pool balanceOf(POOL_ADDR), which overcounted once
// other LPs joined the pool.
async function getLpPosition(torivaPrice) {
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
    const principalTorivaUSD = principalToriva * torivaPrice;

    return {
      principal: {
        usdc: principalUsdc,
        toriva: principalToriva,
        torivaUSD: principalTorivaUSD,
        total: principalUsdc + principalTorivaUSD,
      },
      fees: {
        usdc: feesUsdc,
        toriva: feesToriva,
        torivaUSD: feesTorivaUSD,
        total: feesTotal,
        usdcRatio: feesTotal > 0 ? feesUsdc / feesTotal : 0.5,
        torivaRatio: feesTotal > 0 ? feesTorivaUSD / feesTotal : 0.5,
      },
      tickLower,
      tickUpper,
      currentTick,
      inRange: currentTick >= tickLower && currentTick < tickUpper,
    };
  } catch (e) {
    console.error('LP position read failed:', e.message);
    return null;
  }
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
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

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

    // Read project's actual LP NFT, wallet balances, and historical snapshots in parallel
    const [lpPos, wallet, snap1h, snap6h, snap24h, snap7d, snap30d] = await Promise.all([
      getLpPosition(torivaPrice),
      getWalletBalances(torivaPrice),
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
