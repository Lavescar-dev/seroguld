import type { PosDisplaySnapshot } from '@/types';

export function hasWorksheetRows(snapshot: PosDisplaySnapshot | null | undefined) {
  if (!snapshot) return false;
  return (snapshot.gold_rows?.length ?? 0) > 0 || (snapshot.silver_rows?.length ?? 0) > 0;
}

export function preserveDraftWorksheet(
  previous: PosDisplaySnapshot | null,
  incoming: PosDisplaySnapshot,
) {
  if (!previous || previous.session_code !== incoming.session_code) {
    return incoming;
  }
  if (hasWorksheetRows(incoming) || !hasWorksheetRows(previous)) {
    return incoming;
  }
  if (incoming.trade_side !== 'buy_from_customer' || incoming.status !== 'draft') {
    return incoming;
  }
  // Keep the last visible worksheet when a transient draft frame arrives without row data.
  return {
    ...incoming,
    gold_rows: previous.gold_rows,
    silver_rows: previous.silver_rows,
    lines: incoming.lines.length ? incoming.lines : previous.lines,
    line_count: previous.line_count,
    lines_total_dkk: previous.lines_total_dkk,
    total_weight_grams: previous.total_weight_grams,
    total_pure_gold_grams: previous.total_pure_gold_grams,
    final_offer_dkk: previous.final_offer_dkk,
  };
}

function previewSequence(snapshot: PosDisplaySnapshot | null | undefined) {
  const value = snapshot?.preview_sequence;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function applyIncomingDisplaySnapshot(
  current: PosDisplaySnapshot | null,
  incoming: PosDisplaySnapshot,
  eventType?: string,
) {
  const nextSnapshot = preserveDraftWorksheet(current, incoming);
  if (!current || current.session_code !== nextSnapshot.session_code) {
    return nextSnapshot;
  }

  if (eventType === 'display:preview') {
    const currentSequence = previewSequence(current);
    const nextSequence = previewSequence(nextSnapshot);
    if (currentSequence !== null && nextSequence !== null && nextSequence < currentSequence) {
      return current;
    }

    return {
      ...current,
      customer_name: nextSnapshot.customer_name || current.customer_name,
      customer_phone: nextSnapshot.customer_phone || current.customer_phone,
      customer_email: nextSnapshot.customer_email || current.customer_email,
      customer_address: nextSnapshot.customer_address || current.customer_address,
      customer_postal_code: nextSnapshot.customer_postal_code || current.customer_postal_code,
      customer_city: nextSnapshot.customer_city || current.customer_city,
      customer_cpr_masked: nextSnapshot.customer_cpr_masked || current.customer_cpr_masked,
      customer_identity_doc_number_masked:
        nextSnapshot.customer_identity_doc_number_masked || current.customer_identity_doc_number_masked,
      preview_sequence: nextSnapshot.preview_sequence ?? current.preview_sequence ?? null,
      updated_at: nextSnapshot.updated_at,
    };
  }

  const currentSequence = previewSequence(current);
  if (currentSequence !== null) {
    const mergedSnapshot = { ...nextSnapshot };
    let preservedCustomerPreview = false;
    const customerFields: Array<
      | 'customer_name'
      | 'customer_phone'
      | 'customer_email'
      | 'customer_address'
      | 'customer_postal_code'
      | 'customer_city'
      | 'customer_cpr_masked'
      | 'customer_identity_doc_number_masked'
    > = [
      'customer_name',
      'customer_phone',
      'customer_email',
      'customer_address',
      'customer_postal_code',
      'customer_city',
      'customer_cpr_masked',
      'customer_identity_doc_number_masked',
    ];

    for (const field of customerFields) {
      const incomingValue = mergedSnapshot[field];
      if ((incomingValue === null || incomingValue === undefined || incomingValue === '') && current[field]) {
        mergedSnapshot[field] = current[field];
        preservedCustomerPreview = true;
      }
    }

    if (preservedCustomerPreview) {
      mergedSnapshot.preview_sequence = current.preview_sequence ?? null;
      return mergedSnapshot;
    }
  }

  return nextSnapshot;
}
