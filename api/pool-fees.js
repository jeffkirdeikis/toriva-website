const POOL_ADDR = '0x2393cf60fd67e58e302f6d0b8c552cd5c37caf97';
const BASE_URL = 'https://api.geckoterminal.com/api/v2/networks/base/pools/' + POOL_ADDR;
const FEE_RATE = 0.01; // 1% pool fee

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const [poolRes, ohlcvRes] = await Promise.all([
      fetch(BASE_URL, { headers: { Accept: 'application/json' } }),
      fetch(BASE_URL + '/ohlcv/day?limit=30', { headers: { Accept: 'application/json' } }),
    ]);

    if (!poolRes.ok) {
      return res.status(502).json({ error: 'GeckoTerminal pool request failed' });
    }

    const poolData = await poolRes.json();
    const ohlcvData = ohlcvRes.ok ? await ohlcvRes.json() : null;

    const attr = poolData.data.attributes;
    const tvl = parseFloat(attr.reserve_in_usd) || 0;
    const vol24h = parseFloat(attr.volume_usd.h24) || 0;
    const vol6h = parseFloat(attr.volume_usd.h6) || 0;
    const vol1h = parseFloat(attr.volume_usd.h1) || 0;

    // Calculate fees from volume (fees = volume * fee rate)
    const fees24h = vol24h * FEE_RATE;
    const fees6h = vol6h * FEE_RATE;
    const fees1h = vol1h * FEE_RATE;

    // Sum daily OHLCV volumes for 7d and 30d
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

    const fees7d = vol7d * FEE_RATE;
    const fees30d = vol30d * FEE_RATE;

    return res.status(200).json({
      pool: {
        pair: attr.pool_name || attr.name,
        fee: attr.pool_fee_percentage + '%',
        tvl,
        createdAt: attr.pool_created_at,
      },
      fees: { '1h': fees1h, '6h': fees6h, '24h': fees24h, '7d': fees7d, '30d': fees30d },
      volume: { '1h': vol1h, '6h': vol6h, '24h': vol24h, '7d': vol7d, '30d': vol30d },
      transactions: attr.transactions,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Pool fees error:', err);
    return res.status(500).json({ error: 'Failed to fetch pool data' });
  }
}
