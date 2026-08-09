import type { PosDisplaySnapshot } from '@/types';

function revision(snapshot: PosDisplaySnapshot | null | undefined) {
  const value = snapshot?.workspace_revision;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function previewSequence(snapshot: PosDisplaySnapshot | null | undefined) {
  const value = snapshot?.preview_sequence;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Display frames are full snapshots.  Empty/null values are authoritative;
 * merging with the previous truthy value is exactly what made a clear appear
 * to respawn after a websocket/REST round-trip.
 */
export function applyIncomingDisplaySnapshot(
  current: PosDisplaySnapshot | null,
  incoming: PosDisplaySnapshot,
  eventType?: string,
) {
  if (!current || current.session_code !== incoming.session_code) return incoming;

  const currentRevision = revision(current);
  const nextRevision = revision(incoming);
  if (nextRevision < currentRevision) return current;

  if (nextRevision === currentRevision) {
    const currentSequence = previewSequence(current);
    const nextSequence = previewSequence(incoming);
    if (eventType === 'display:preview' && nextSequence <= currentSequence) return current;
    // A committed display:update at the same revision intentionally replaces
    // the transient preview, including explicit empty fields and rows.
    if (eventType !== 'display:preview' && currentSequence > 0 && nextSequence === 0) {
      return incoming;
    }
    if (eventType === 'display:preview' && nextSequence < currentSequence) return current;
  }

  return incoming;
}
