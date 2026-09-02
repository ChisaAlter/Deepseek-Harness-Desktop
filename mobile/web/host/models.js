function supportsImagesOf(model) {
  const modalities = model && Array.isArray(model.inputModalities) ? model.inputModalities : null;
  if (!modalities) return undefined;
  return modalities.includes('image');
}

/**
 * Flatten the host model catalog. `selection` is the session's durable
 * model-selection projection (`{ lastUsed, pending }` / `{ next }`); the
 * desktop resolves the current model as `projection.next ?? catalog.default`,
 * and the catalog alone never knows what one session picked.
 */
function flattenModels(catalog, selection) {
  const rows = [];
  const routable = Array.isArray(catalog?.routableProviders) ? new Set(catalog.routableProviders) : null;
  for (const group of Array.isArray(catalog?.groups) ? catalog.groups : []) {
    for (const model of group.models || []) {
      rows.push({
        provider: group.id,
        providerName: group.name || group.id,
        id: model.id,
        name: model.name || model.id,
        reasoning: model.reasoning && Array.isArray(model.reasoning.efforts)
          ? model.reasoning
          : null,
        supportsImages: supportsImagesOf(model),
        // null = the host did not report routability (older hosts): assume fine.
        routable: routable === null ? null : routable.has(group.id),
      });
    }
  }
  const selected = selectionFromProjection(selection);
  let current = selected
    || (catalog?.current && typeof catalog.current === 'object' ? catalog.current : null)
    || (catalog?.default && typeof catalog.default === 'object' ? catalog.default : null);
  if (current) {
    const row = rows.find((item) => item.provider === current.provider && item.id === current.model);
    current = { ...current, supportsImages: row ? row.supportsImages : undefined };
  }
  return {
    current,
    rows,
    routableProviders: routable === null ? null : [...routable],
    failures: Array.isArray(catalog?.failures) ? catalog.failures : [],
  };
}

/** The session's own selection out of the `modelSelection` projection value. */
function selectionFromProjection(value) {
  if (!value || typeof value !== 'object') return null;
  const pick = value.next || value.pending || value.lastUsed || null;
  if (!pick || typeof pick !== 'object') return null;
  if (typeof pick.provider !== 'string' || typeof pick.model !== 'string') return null;
  const out = { provider: pick.provider, model: pick.model };
  if (typeof pick.reasoningEffort === 'string') out.reasoningEffort = pick.reasoningEffort;
  return out;
}

function isRoutable(row) {
  return row?.routable !== false;
}

function matchRow(current, rows) {
  if (!current) return null;
  return rows.find((row) => row.provider === current.provider && row.id === current.model) || null;
}

function modelChipLabel(current, rows) {
  if (!current?.model) return '模型';
  const row = matchRow(current, rows);
  const name = row?.name || current.model;
  const effort = current.reasoningEffort;
  if (effort && row?.reasoning) return `${name} · ${effort}`;
  return name;
}

function effortsFor(current, rows) {
  const row = matchRow(current, rows);
  return Array.isArray(row?.reasoning?.efforts) ? row.reasoning.efforts : [];
}

export { effortsFor, flattenModels, isRoutable, modelChipLabel, selectionFromProjection };
