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
const Q128 = BigInt(2) ** BigInt(128);
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // Save snapshot every 5 minutes

const USDC_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TORIVA_ADDR = '0xb886Cf1444BFF05e9a99E00543BC4054d423ebFD';
const TREASURY_WALLET = '0x2633148755A12c6D5aBD75Eed90B4a6572275Cdb';

// Read a uint256 from any contract, with RPC fallback
async function readContract(contractAddr, data) {
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
      return BigInt(result);
    } catch (e) {
      continue;
    }
  }
  throw new Error('All RPCs failed for contract ' + contractAddr);
}

// Read a uint256 from the pool contract, with RPC fallback
async function readPool(selector) {
  return readContract(POOL_ADDR, selector);
}

// balanceOf(address) calldata
function balanceOfData(address) {
  return '0x70a08231000000000000000000000000' + address.slice(2).toLowerCase();
}

// Fetch treasury wallet USDC and LP position token balances
async function getTreasuryData(torivaPrice) {
  try {
    const [walletUsdc, poolUsdc, poolToriva] = await Promise.all([
      readContract(USDC_ADDR, balanceOfData(TREASURY_WALLET)),
      readContract(USDC_ADDR, balanceOfData(POOL_ADDR)),
      readContract(TORIVA_ADDR, balanceOfData(POOL_ADDR)),
    ]);
    const walletUsdcNum = Number(walletUsdc) / 1e6;
    const poolUsdcNum = Number(poolUsdc) / 1e6;
    const poolTorivaNum = Number(poolToriva) / 1e18;
    const poolTorivaUSD = poolTorivaNum * torivaPrice;
    return {
      walletUsdc: walletUsdcNum,
      lpPosition: {
        usdc: poolUsdcNum,
        toriva: poolTorivaNum,
        torivaUSD: poolTorivaUSD,
        total: poolUsdcNum + poolTorivaUSD,
      },
    };
  } catch (e) {
    console.error('Treasury data fetch failed:', e.message);
    return null;
  }
}

// Read protocol fee from slot0
async function getProtocolFeeMultiplier() {
  try {
    for (const rpc of RPC_ENDPOINTS) {
      try {
        const res = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'eth_call', id: 1,
            params: [{ to: POOL_ADDR, data: '0x3850c7bd' }, 'latest']
          })
        });
        if (!res.ok) continue;
        const { result, error } = await res.json();
        if (error || !result) continue;
        const feeProtocolHex = result.slice(2 + 5 * 64, 2 + 6 * 64);
        const feeProtocol = parseInt(feeProtocolHex, 16);
        const fp0 = feeProtocol & 0xF;
        return fp0 > 0 ? (1 - 1 / fp0) : 1;
      } catch (e) {
        continue;
      }
    }
    return 1;
  } catch (e) {
    return 1;
  }
}

// Get actual cumulative fees from on-chain feeGrowthGlobal data
async function getCumulativeFees(torivaPrice) {
  try {
    const [fg0, fg1, liq] = await Promise.all([
      readPool('0xf3058399'), // feeGrowthGlobal0X128 (USDC, token0, 6 decimals)
      readPool('0x46141319'), // feeGrowthGlobal1X128 (TORIVA, token1, 18 decimals)
      readPool('0x1a686502'), // liquidity
    ]);

    const usdcFees = Number(fg0 * liq / Q128) / 1e6;
    const torivaFees = Number(fg1 * liq / Q128) / 1e18;
    const torivaFeesUSD = torivaFees * torivaPrice;
    const total = usdcFees + torivaFeesUSD;

    return {
      usdc: usdcFees,
      toriva: torivaFees,
      torivaUSD: torivaFeesUSD,
      total: total,
      usdcRatio: total > 0 ? usdcFees / total : 0.5,
      torivaRatio: total > 0 ? torivaFeesUSD / total : 0.5,
    };
  } catch (e) {
    console.error('On-chain fee read failed:', e.message);
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

// Compute fee delta between current cumulative and a historical snapshot
function computeDelta(cumulative, snapshot, currentPrice) {
  if (!snapshot) return null;
  const usdcDelta = Math.max(0, cumulative.usdc - Number(snapshot.usdc_fees));
  const torivaDelta = Math.max(0, cumulative.toriva - Number(snapshot.toriva_fees));
  const torivaUSD = torivaDelta * currentPrice;
  return { usdc: usdcDelta, toriva: torivaDelta, torivaUSD };
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
      fetch(GECKO_URL + '/ohlcv/day?limit=30', { headers: { Accept: 'application/json' } }),
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

    // Read actual cumulative fees, protocol fee, treasury data, and historical snapshots in parallel
    const [cumulative, lpMultiplier, treasury, snap1h, snap6h, snap24h, snap7d, snap30d] = await Promise.all([
      getCumulativeFees(torivaPrice),
      getProtocolFeeMultiplier(),
      getTreasuryData(torivaPrice),
      getSnapshotAt(1),
      getSnapshotAt(6),
      getSnapshotAt(24),
      getSnapshotAt(24 * 7),
      getSnapshotAt(24 * 30),
    ]);

    // Save current cumulative fees as a snapshot (throttled) and clean old ones
    if (cumulative) {
      saveSnapshot(cumulative.usdc, cumulative.toriva, torivaPrice);
      cleanOldSnapshots();
    }

    // Use on-chain ratio for splits, fallback to 50/50
    const usdcRatio = cumulative ? cumulative.usdcRatio : 0.5;
    const torivaRatio = cumulative ? cumulative.torivaRatio : 0.5;

    // Compute time-windowed fees from on-chain snapshot deltas
    const delta1h = cumulative ? computeDelta(cumulative, snap1h, torivaPrice) : null;
    const delta6h = cumulative ? computeDelta(cumulative, snap6h, torivaPrice) : null;
    const delta24h = cumulative ? computeDelta(cumulative, snap24h, torivaPrice) : null;
    const delta7d = cumulative ? computeDelta(cumulative, snap7d, torivaPrice) : null;
    const delta30d = cumulative ? computeDelta(cumulative, snap30d, torivaPrice) : null;

    // Fallback to volume-based estimates if no snapshots exist yet
    const fallback = (hours, vol) => {
      const fees = vol * FEE_RATE * lpMultiplier;
      return splitFees(fees, usdcRatio, torivaRatio, torivaPrice);
    };

    // For 7d/30d volume fallback, compute from OHLCV data
    const days = ohlcvData?.data?.attributes?.ohlcv_list || [];
    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;
    let vol7d = 0, vol30d = 0;
    for (const bar of days) {
      const ts = bar[0];
      const vol = bar[5] || 0;
      if (ts >= now - 7 * DAY) vol7d += vol;
      vol30d += vol;
    }

    const split = {
      '1h': delta1h || fallback(1, vol1h),
      '6h': delta6h || fallback(6, vol6h),
      '24h': delta24h || fallback(24, vol24h),
      '7d': delta7d || fallback(168, vol7d),
      '30d': delta30d || fallback(720, vol30d),
    };

    // Total fees for each window (USD value)
    const feeTotal = (s) => s.usdc + s.torivaUSD;

    return res.status(200).json({
      pool: {
        pair: attr.pool_name || attr.name,
        fee: attr.pool_fee_percentage + '%',
        lpFeeMultiplier: lpMultiplier,
        tvl,
        torivaPrice,
        createdAt: attr.pool_created_at,
      },
      cumulative: cumulative ? {
        usdc: cumulative.usdc,
        toriva: cumulative.toriva,
        torivaUSD: cumulative.torivaUSD,
        total: cumulative.total,
      } : null,
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
      onChain: {
        usdcRatio,
        torivaRatio,
        totalUsdcFees: cumulative ? cumulative.usdc : 0,
        totalTorivaFees: cumulative ? cumulative.toriva : 0,
      },
      volume: { '1h': vol1h, '6h': vol6h, '24h': vol24h, '7d': vol7d, '30d': vol30d },
      transactions: txn,
      treasury: treasury || null,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Pool fees error:', err);
    return res.status(500).json({ error: 'Failed to fetch pool data' });
  }
}
