const POOL_ID = '0xb886cf1444bff05e9a99e00543bc4054d423ebfd';
const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/48211/uniswap-v3-base/version/latest';

const QUERY = `{
  pool(id: "${POOL_ID}") {
    feesUSD
    volumeUSD
    totalValueLockedUSD
    token0 { symbol }
    token1 { symbol }
    feeTier
  }
  daily: poolDayDatas(
    first: 30
    orderBy: date
    orderDirection: desc
    where: { pool: "${POOL_ID}" }
  ) {
    date
    feesUSD
    volumeUSD
  }
}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const response = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY })
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Subgraph unavailable' });
    }

    const result = await response.json();

    if (result.errors) {
      return res.status(502).json({ error: 'Subgraph query error' });
    }

    if (!result.data || !result.data.pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    const pool = result.data.pool;
    const daily = result.data.daily || [];

    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;

    let fees24h = 0, fees7d = 0, fees30d = 0;
    let vol24h = 0, vol7d = 0, vol30d = 0;

    for (const d of daily) {
      const ts = parseInt(d.date);
      const fee = parseFloat(d.feesUSD);
      const vol = parseFloat(d.volumeUSD);

      if (ts >= now - DAY) { fees24h += fee; vol24h += vol; }
      if (ts >= now - 7 * DAY) { fees7d += fee; vol7d += vol; }
      fees30d += fee;
      vol30d += vol;
    }

    return res.status(200).json({
      pool: {
        feesAllTime: parseFloat(pool.feesUSD),
        volumeAllTime: parseFloat(pool.volumeUSD),
        tvl: parseFloat(pool.totalValueLockedUSD),
        pair: pool.token0.symbol + ' / ' + pool.token1.symbol,
        feeTier: (parseInt(pool.feeTier) / 10000) + '%',
      },
      fees: { '24h': fees24h, '7d': fees7d, '30d': fees30d },
      volume: { '24h': vol24h, '7d': vol7d, '30d': vol30d },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Pool fees error:', err);
    return res.status(500).json({ error: 'Failed to fetch pool data' });
  }
}
