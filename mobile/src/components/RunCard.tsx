import { StyleSheet, Text, View } from 'react-native';
import type { AssistantRequirements, AssistantRun, Recommendation } from '../lib/api';
import { formatAed } from '../lib/format';

/** `0` bedrooms is a studio -- and falsy, so it needs an explicit null check. */
function bedroomsLabel(bedrooms: number | null): string | null {
  if (bedrooms === null) return null;
  return bedrooms === 0 ? 'Studio' : `${bedrooms} bed`;
}

function budgetLabel(budget: AssistantRequirements['budgetAed']): string | null {
  if (budget.min !== null && budget.max !== null) return `${formatAed(budget.min)} – ${formatAed(budget.max)}`;
  if (budget.max !== null) return `up to ${formatAed(budget.max)}`;
  if (budget.min !== null) return `from ${formatAed(budget.min)}`;
  return null;
}

/** The API sends an unrounded ratio (0.0731707…), not a percentage. */
function yieldLabel(grossYield: number | null): string {
  return grossYield === null ? 'Yield unavailable' : `${(grossYield * 100).toFixed(1)}% gross yield`;
}

function RecommendationItem({ recommendation }: { recommendation: Recommendation }) {
  const { property, reason } = recommendation;
  return (
    <View style={styles.item}>
      <Text style={styles.itemTitle}>
        {property.reference} · {property.title}
      </Text>
      <Text style={styles.meta}>
        {[property.area, bedroomsLabel(property.bedrooms), formatAed(property.priceAed), yieldLabel(property.grossYield), property.status]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text style={styles.reason}>{reason}</Text>
    </View>
  );
}

/**
 * One assistant run. A failed run and a run that found nothing look different on purpose: TASK.md
 * requires that a failure never reads as "no matching properties".
 */
export function RunCard({ run }: { run: AssistantRun }) {
  if (run.status === 'failed') {
    return (
      <View style={styles.failed}>
        <Text style={styles.failedTitle}>The run failed — this is not a &quot;nothing found&quot;.</Text>
        <Text style={styles.failedBody}>{run.error ?? 'No error message was recorded.'}</Text>
      </View>
    );
  }

  const understood = [
    run.requirements.locations.length > 0 ? run.requirements.locations.join(', ') : null,
    bedroomsLabel(run.requirements.bedrooms),
    run.requirements.propertyType,
    budgetLabel(run.requirements.budgetAed),
    run.requirements.intent === 'unknown' ? null : `to ${run.requirements.intent}`,
  ].filter(Boolean);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>UNDERSTOOD</Text>
      <Text style={styles.understood}>{understood.length > 0 ? understood.join(' · ') : 'Nothing specific yet.'}</Text>
      {run.requirements.preferences.length > 0 && (
        <Text style={styles.meta}>Prefers {run.requirements.preferences.join(', ')}</Text>
      )}

      {run.summary !== '' && <Text style={styles.summary}>{run.summary}</Text>}

      {run.recommendations.length > 0 ? (
        run.recommendations.map((recommendation) => (
          <RecommendationItem key={recommendation.propertyId} recommendation={recommendation} />
        ))
      ) : (
        <Text style={styles.meta}>No listings recommended.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: '#6b7280', fontSize: 11, fontWeight: '500', letterSpacing: 0.5 },
  understood: { color: '#111827' },
  summary: { color: '#4b5563', marginTop: 2 },
  meta: { color: '#6b7280', fontSize: 12 },
  item: { borderRadius: 8, backgroundColor: '#f6f7f9', borderWidth: 1, borderColor: '#e5e7eb', padding: 10, gap: 2 },
  itemTitle: { color: '#111827', fontWeight: '500' },
  reason: { color: '#4b5563', fontSize: 13 },
  failed: { borderRadius: 8, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', padding: 12, gap: 4 },
  failedTitle: { color: '#991b1b', fontWeight: '500' },
  failedBody: { color: '#b91c1c', fontSize: 12 },
});
