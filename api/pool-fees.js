const POOL_ADDR = '0x2393cf60fd67e58e302f6d0b8c552cd5c37caf97';
const GECKO_URL = 'https://api.geckoterminal.com/api/v2/networks/base/pools/' + POOL_ADDR;
const BASE_RPC = 'https://mainnet.base.org';
const FEE_RATE = 0.01;
const Q128 = BigInt(2) ** BigInt(128);

// Read a uint256 from the pool contract
async function readPool(selector) {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'eth_call', id: 1,
      params: [{ to: POOL_ADDR, data: selector }, 'latest']
    })
  });
  const { result } = await res.json();
  return BigInt(result);
}

// Read the protocol fee from slot0 to calculate LP's actual share
// In Uniswap V3, feeProtocol is packed as two 4-bit values (token0, token1).
// If N > 0, the protocol takes 1/N of swap fees; LPs get (1 - 1/N).
async function getProtocolFeeMultiplier() {
  try {
    const res = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'eth_call', id: 1,
        params: [{ to: POOL_ADDR, data: '0x3850c7bd' }, 'latest'] // slot0()
      })
    });
    const { result } = await res.json();
    // feeProtocol is the 6th 32-byte field in slot0
    const feeProtocolHex = result.slice(2 + 5 * 64, 2 + 6 * 64);
    const feeProtocol = parseInt(feeProtocolHex, 16);
    const fp0 = feeProtocol & 0xF;
    // If fp0 > 0, protocol takes 1/fp0; LPs get the rest
    return fp0 > 0 ? (1 - 1 / fp0) : 1;
  } catch (e) {
    return 1; // Default to no protocol fee on error
  }
}

// Get the actual USDC/TORIVA fee split ratio from on-chain data
async function getFeeSplitRatio(torivaPrice) {
  try {
    const [fg0, fg1, liq] = await Promise.all([
      readPool('0xf3058399'), // feeGrowthGlobal0X128 (USDC, 6 decimals)
      readPool('0x46141319'), // feeGrowthGlobal1X128 (TORIVA, 18 decimals)
      readPool('0x1a686502'), // liquidity
    ]);

    // Convert from Q128 fixed-point to actual token amounts
    const usdcFees = Number(fg0 * liq / Q128) / 1e6;
    const torivaFees = Number(fg1 * liq / Q128) / 1e18;
    const torivaFeesUSD = torivaFees * torivaPrice;
    const total = usdcFees + torivaFeesUSD;

    if (total === 0) return { usdcRatio: 0.5, torivaRatio: 0.5, usdcFees, torivaFees };

    return {
      usdcRatio: usdcFees / total,
      torivaRatio: torivaFeesUSD / total,
      usdcFees,
      torivaFees,
    };
  } catch (e) {
    return { usdcRatio: 0.5, torivaRatio: 0.5, usdcFees: 0, torivaFees: 0 };
  }
}

function splitFees(totalFeesUSD, usdcRatio, torivaRatio, torivaPrice) {
  var usdcFees = totalFeesUSD * usdcRatio;
  var torivaFeesUSD = totalFeesUSD * torivaRatio;
  var torivaFees = torivaPrice > 0 ? torivaFeesUSD / torivaPrice : 0;
  return { usdc: usdcFees, toriva: torivaFees, torivaUSD: torivaFeesUSD };
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

    // Read protocol fee from contract: LP only receives a fraction of gross fees
    const lpMultiplier = await getProtocolFeeMultiplier();

    const fees1h = vol1h * FEE_RATE * lpMultiplier;
    const fees6h = vol6h * FEE_RATE * lpMultiplier;
    const fees24h = vol24h * FEE_RATE * lpMultiplier;

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

    const fees7d = vol7d * FEE_RATE * lpMultiplier;
    const fees30d = vol30d * FEE_RATE * lpMultiplier;

    // Get actual split ratio from on-chain fee growth data
    const ratio = await getFeeSplitRatio(torivaPrice);

    const split = {
      '1h': splitFees(fees1h, ratio.usdcRatio, ratio.torivaRatio, torivaPrice),
      '6h': splitFees(fees6h, ratio.usdcRatio, ratio.torivaRatio, torivaPrice),
      '24h': splitFees(fees24h, ratio.usdcRatio, ratio.torivaRatio, torivaPrice),
      '7d': splitFees(fees7d, ratio.usdcRatio, ratio.torivaRatio, torivaPrice),
      '30d': splitFees(fees30d, ratio.usdcRatio, ratio.torivaRatio, torivaPrice),
    };

    return res.status(200).json({
      pool: {
        pair: attr.pool_name || attr.name,
        fee: attr.pool_fee_percentage + '%',
        lpFeeMultiplier: lpMultiplier,
        tvl,
        torivaPrice,
        createdAt: attr.pool_created_at,
      },
      fees: { '1h': fees1h, '6h': fees6h, '24h': fees24h, '7d': fees7d, '30d': fees30d },
      split,
      onChain: {
        usdcRatio: ratio.usdcRatio,
        torivaRatio: ratio.torivaRatio,
        totalUsdcFees: ratio.usdcFees,
        totalTorivaFees: ratio.torivaFees,
      },
      volume: { '1h': vol1h, '6h': vol6h, '24h': vol24h, '7d': vol7d, '30d': vol30d },
      transactions: txn,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Pool fees error:', err);
    return res.status(500).json({ error: 'Failed to fetch pool data' });
  }
}
