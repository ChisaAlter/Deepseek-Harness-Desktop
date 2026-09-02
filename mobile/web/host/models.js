function supportsImagesOf(model) {
  const modalities = model && Array.isArray(model.inputModalities) ? model.inputModalities : null;
  if (!modalities) return undefined;
  return modalities.includes('image');
}

function flattenModels(catalog) {
  const rows = [];
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
      });
    }
  }
  let current = catalog?.current && typeof catalog.current === 'object'
    ? catalog.current
    : null;
  if (current) {
    const row = rows.find((item) => item.provider === current.provider && item.id === current.model);
    current = { ...current, supportsImages: row ? row.supportsImages : undefined };
  }
  return {
    current,
    rows,
    failures: Array.isArray(catalog?.failures) ? catalog.failures : [],
  };
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

export { effortsFor, flattenModels, modelChipLabel };
