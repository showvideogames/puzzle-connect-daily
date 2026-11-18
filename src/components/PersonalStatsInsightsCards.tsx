import type { PersonalStatsInsights } from '@/lib/personalStatsInsights';
import type { CategoryColor } from '@/lib/puzzleFormat';

const labels: Record<CategoryColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', red: 'Red' };
export function PersonalStatsInsightsCards({ insights, hasRainbow }: { insights: PersonalStatsInsights; hasRainbow: boolean }) {
  const { rainbowTiming: timing, startingColors: colors } = insights;
  const classified = timing.first + timing.last;
  const firstPercent = classified ? Math.round(timing.first / classified * 100) : 0;
  return <div className="personal-stats-insights">
    {hasRainbow && <section className="personal-stats-insight" aria-labelledby="rainbow-timing-title">
      <h3 id="rainbow-timing-title">First vs Last</h3>
      <p className="personal-stats-insight-caption">When You Spotted the Rainbow</p>
      {classified > 0 ? <>
        <div className="personal-stats-timing">
          <div className="personal-stats-pie" aria-hidden="true" style={{ background: `conic-gradient(#a331ff 0 ${timing.first / classified * 100}%, #008b91 0 100%)` }} />
          <dl className="personal-stats-timing-legend">
            <div><dt><span className="timing-first" />First</dt><dd>{firstPercent}% <small>({timing.first})</small></dd></div>
            <div><dt><span className="timing-last" />Last</dt><dd>{100 - firstPercent}% <small>({timing.last})</small></dd></div>
          </dl>
        </div>
        <p className="personal-stats-insight-note">Based on {classified} Rainbow {classified === 1 ? 'find' : 'finds'} with known timing.</p>
      </> : <p className="personal-stats-insight-empty">No Rainbow finds with known timing yet.</p>}
      {timing.unknown > 0 && <p className="personal-stats-insight-note">Timing unknown for {timing.unknown} historical {timing.unknown === 1 ? 'find' : 'finds'}; excluded from the chart.</p>}
    </section>}
    <section className="personal-stats-insight" aria-labelledby="starting-color-title">
      <h3 id="starting-color-title">Favorite Starting Color</h3>
      <p className="personal-stats-insight-caption">Your First Regular Category Solved</p>
      {colors.known > 0 ? <>
        <div className="personal-stats-color-leaders">{colors.leaders.map(color => <span key={color} className={`personal-stats-color-chip ${color}`}>{labels[color]}</span>)}</div>
        {colors.leaders.length > 1 && <p className="personal-stats-insight-note">Tied for Most Frequent</p>}
        <dl className="personal-stats-color-counts">{(Object.entries(colors.counts) as [CategoryColor, number][]).map(([color, count]) =>
          <div key={color}><dt><span className={`personal-stats-color-dot ${color}`} />{labels[color]}</dt><dd>{count}</dd></div>)}</dl>
        <p className="personal-stats-insight-note">Based on {colors.known} {colors.known === 1 ? 'game' : 'games'} with a recorded starting color. Rainbow is excluded.</p>
      </> : <p className="personal-stats-insight-empty">No recorded starting colors yet.</p>}
      {colors.excluded > 0 && <p className="personal-stats-insight-note">{colors.excluded} {colors.excluded === 1 ? 'game has' : 'games have'} no usable solve order; excluded.</p>}
    </section>
  </div>;
}
