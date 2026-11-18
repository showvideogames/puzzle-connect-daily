import type { PersonalStatsInsights } from '@/lib/personalStatsInsights';
import type { CategoryColor } from '@/lib/puzzleFormat';

const labels: Record<CategoryColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', red: 'Red' };
const percent = (share: number) => share > 0 && share < .01 ? '<1%' : share < 1 && share > .99 ? '>99%' : `${Math.round(share * 100)}%`;

function TimingPie({ first, last }: { first: number; last: number }) {
  const total = first + last;
  const slices = [
    { label: 'First', share: first / total, start: 0, fill: '#f6a6d2', text: '#fff' },
    { label: 'Last', share: last / total, start: first / total, fill: '#8739d7', text: '#fff' },
  ];
  const point = (turn: number, radius: number) => [120 + Math.sin(turn * Math.PI * 2) * radius, 120 - Math.cos(turn * Math.PI * 2) * radius];
  const description = slices.map(s => `${s.label} ${percent(s.share)}`).join('. ');
  return <svg className="personal-stats-pie" viewBox="0 0 240 240" role="img" aria-label={description}>
    <title>{description}</title>
    {slices.filter(s => s.share > 0).map(s => {
      const [x1,y1] = point(s.start,110), [x2,y2] = point(s.start+s.share,110);
      const compact = s.share < .2;
      const majority = s.share > .5;
      const middle = s.start+s.share/2;
      const [x,centerY] = s.share === 1 ? [120,120] : point(middle,compact ? 80 : 64);
      const y = centerY - (s.label === 'First' && s.share > .5 && s.share < 1 ? 24 : 0);
      let rotation = middle * 360 - 90;
      if (rotation > 90) rotation -= 180;
      // Very small slices cannot hold legible labels. Their exact percentage
      // stays in the chart's accessible name/title; never place it in another slice.
      return <g key={s.label} aria-hidden="true">
        {s.share === 1 ? <circle cx="120" cy="120" r="110" fill={s.fill} /> :
          <path d={`M120 120 L${x1} ${y1} A110 110 0 ${s.share > .5 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={s.fill} />}
        {s.share >= .05 && (compact
          ? <text transform={`translate(${x} ${y}) rotate(${rotation})`} textAnchor="middle" dominantBaseline="central" fill={s.text} className="personal-stats-slice-compact"><tspan className="personal-stats-slice-name">{s.label}</tspan> <tspan>{percent(s.share)}</tspan></text>
          : <text x={x} y={y-(majority ? 9 : 5)} textAnchor="middle" fill={s.text} className={majority ? "personal-stats-slice-majority" : undefined}>
            <tspan x={x} className="personal-stats-slice-name">{s.label}</tspan>
            <tspan x={x} dy={majority ? 32 : 25} className="personal-stats-slice-percent">{percent(s.share)}</tspan>
          </text>)}
      </g>;
    })}
  </svg>;
}

export function PersonalStatsInsightsCards({ insights, hasRainbow }: { insights: PersonalStatsInsights; hasRainbow: boolean }) {
  const { rainbowTiming: timing, startingColors: colors } = insights;
  const classified = timing.first + timing.last;
  return <div className="personal-stats-insights">
    {hasRainbow && <section className="personal-stats-insight personal-stats-timing-card" aria-labelledby="rainbow-timing-title" aria-describedby="rainbow-timing-description">
      <h3 id="rainbow-timing-title">Spotted the Rainbow 🌈</h3>
      {classified > 0 ? <TimingPie first={timing.first} last={timing.last} /> :
        <div className="personal-stats-empty"><span aria-hidden="true">—</span>{timing.unknown ? 'Timing Unknown' : 'No Rainbows Yet'}</div>}
      <p id="rainbow-timing-description" className="sr-only">When you spotted the Rainbow. Percentages use only finds with known timing. {timing.unknown} historical finds have unknown timing and are excluded.</p>
    </section>}
    <section className="personal-stats-insight" aria-labelledby="starting-color-title" aria-describedby="starting-color-description">
      <h3 id="starting-color-title">Favorite Starting Color</h3>
      {colors.known > 0 ? <>
        <div className="personal-stats-color-leaders">{colors.leaders.map(color => <span key={color} className={`personal-stats-color-chip ${color}`}>{labels[color]}</span>)}
          {colors.leaders.length > 1 && <span className="personal-stats-tie">Tie</span>}
        </div>
        <dl className="personal-stats-color-counts">{(Object.entries(colors.counts) as [CategoryColor, number][]).map(([color, count]) =>
          <div key={color}><dt><span className={`personal-stats-color-dot ${color}`} />{labels[color]}</dt><dd>{count}</dd></div>)}</dl>
      </> : <div className="personal-stats-empty"><span aria-hidden="true">—</span>No Recorded Colors</div>}
      <p id="starting-color-description" className="sr-only">First regular category solved; Rainbow is excluded. {colors.known} games have a recorded starting color. {colors.excluded} games have no usable solve order and are excluded.{colors.leaders.length > 1 ? ' Tied for most frequent.' : ''}</p>
    </section>
  </div>;
}
