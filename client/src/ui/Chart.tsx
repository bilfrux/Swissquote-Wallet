// Courbe d'évolution (SVG) avec dégradé, à la manière de l'appli mobile. Données fournies par l'appelant.
export function Chart({ points, height = 120 }: { points: number[]; height?: number }) {
  const w = 300;
  const min = Math.min(...points), max = Math.max(...points);
  const y = (v: number) => (max === min ? height / 2 : height - 8 - ((v - min) / (max - min)) * (height - 16));
  const xs = points.map((_, i) => (i / (points.length - 1)) * w);
  const line = points.map((v, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label="évolution">
      <defs>
        <linearGradient id="sq-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2f64d8" stopOpacity=".25" />
          <stop offset="1" stopColor="#2f64d8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill="url(#sq-grad)" />
      <path d={line} fill="none" stroke="#2f64d8" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
