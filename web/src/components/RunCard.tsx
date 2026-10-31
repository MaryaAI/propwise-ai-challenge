import type { AssistantRequirements, AssistantRun, Recommendation } from '@/lib/api';
import { formatAed } from '@/lib/format';

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

function Requirements({ requirements }: { requirements: AssistantRequirements }) {
  const parts = [
    requirements.locations.length > 0 ? requirements.locations.join(', ') : null,
    bedroomsLabel(requirements.bedrooms),
    requirements.propertyType,
    budgetLabel(requirements.budgetAed),
    requirements.intent === 'unknown' ? null : `to ${requirements.intent}`,
  ].filter(Boolean);

  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-gray-500 uppercase">Understood</h3>
      <p className="mt-1 text-sm">{parts.length > 0 ? parts.join(' · ') : 'Nothing specific yet.'}</p>
      {requirements.preferences.length > 0 && (
        <p className="mt-0.5 text-xs text-gray-500">Prefers {requirements.preferences.join(', ')}</p>
      )}
    </div>
  );
}

function RecommendationItem({ recommendation }: { recommendation: Recommendation }) {
  const { property, reason } = recommendation;
  return (
    <li className="rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
      <p className="text-sm font-medium">
        {property.reference} · {property.title}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        {[property.area, bedroomsLabel(property.bedrooms), formatAed(property.priceAed), yieldLabel(property.grossYield), property.status]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="mt-1 text-sm text-gray-700">{reason}</p>
    </li>
  );
}

/**
 * One assistant run. A failed run and a run that found nothing are deliberately different: TASK.md
 * requires that a failure never reads as "no matching properties".
 */
export function RunCard({ run }: { run: AssistantRun }) {
  if (run.status === 'failed') {
    return (
      <div className="rounded-lg bg-red-50 p-3 ring-1 ring-red-200">
        <p className="text-sm font-medium text-red-800">The run failed — this is not a "nothing found".</p>
        <p className="mt-1 text-xs text-red-700">{run.error ?? 'No error message was recorded.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Requirements requirements={run.requirements} />

      {run.summary && <p className="text-sm text-gray-700">{run.summary}</p>}

      {run.recommendations.length > 0 ? (
        <ul className="space-y-2">
          {run.recommendations.map((recommendation) => (
            <RecommendationItem key={recommendation.propertyId} recommendation={recommendation} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">No listings recommended.</p>
      )}

      {run.trace.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-500">{run.trace.length} tool calls</summary>
          <ul className="mt-1 space-y-0.5">
            {run.trace.map((entry, index) => (
              <li key={`${entry.tool}-${index}`} className="text-xs text-gray-500">
                {entry.tool} · {entry.durationMs}ms
                {entry.error ? ` · failed: ${entry.error}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
