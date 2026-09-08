import { useCallback, useState } from 'react';
import type { DragEvent } from 'react';

/**
 * Fotoğraf kartı sürükle-sıralama ortak yardımcısı (R1-36 deseninin soyutlaması).
 *
 * DepolamaPage'de doğan desen dört Woo yüzeyine (modern PhotosTab, klasik detay,
 * iki sihirbaz adım 4) ve depo sayfasına aynı kurallarla bağlanır:
 * - `ids` DEDUP ÖNCESİ, yalnız gerçek-id'li liste olmalı (render dedup'ı id
 *   gizleyebilir; kalıcı sıra tam liste üzerinden PUT edilir).
 * - Kart-üstü drop `stopPropagation` + `preventDefault` yapar; aksi halde
 *   kap aynı zamanda dosya-dropzone'u olduğu için yanlışlıkla yükleme başlar.
 * - `onDragOver` yalnız aktif sürüklemede `preventDefault` eder; yoksa drop
 *   olayı hiç ateşlenmez.
 */

export type PhotoReorderController = {
  /** Sürüklenen kartın id'si; yoksa null. */
  dragPhotoId: string | null;
  onDragStart: (event: DragEvent<HTMLElement>, photoId: string) => void;
  onDragOverCard: (event: DragEvent<HTMLElement>) => void;
  onDropCard: (event: DragEvent<HTMLElement>, targetId: string) => void;
  onDragEnd: () => void;
};

/**
 * Sürüklenen kartı hedefin önüne taşır. No-op durumlarında (id'ler listede
 * yok veya konum zaten aynı) GİRDİ REFERANSINI değiştirmeden döner; çağıran
 * referans kimliğiyle gereksiz commit'i atlayabilir.
 */
export function moveId(ids: readonly string[], dragId: string, targetId: string): string[] {
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function usePhotoReorder(options: {
  /** Sıralanacak id listesi — dedup ÖNCESİ, id'sizler elenmiş hali. */
  ids: readonly string[];
  disabled?: boolean;
  /** Kalıcı yüzeyler: sıra sunucuya PUT edilir. */
  onCommit?: (orderedIds: string[]) => void;
  /** Sihirbaz yüzeyleri: yerel form dizisi yeniden kurulur, ağ yok. */
  onLocalReorder?: (orderedIds: string[]) => void;
}): PhotoReorderController {
  const { ids, disabled = false, onCommit, onLocalReorder } = options;
  const [dragPhotoId, setDragPhotoId] = useState<string | null>(null);

  const onDragStart = useCallback(
    (event: DragEvent<HTMLElement>, photoId: string) => {
      if (disabled || !photoId) return;
      // Firefox verisiz dragstart'ı hiç başlatmaz; text/plain zorunlu.
      event.dataTransfer.setData('text/plain', photoId);
      event.dataTransfer.effectAllowed = 'move';
      setDragPhotoId(photoId);
    },
    [disabled],
  );

  const onDragOverCard = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (dragPhotoId) event.preventDefault();
    },
    [dragPhotoId],
  );

  const onDropCard = useCallback(
    (event: DragEvent<HTMLElement>, targetId: string) => {
      event.preventDefault();
      // Kap dropzone'u tetiklemesin (dosya yükleme yanılgısı).
      event.stopPropagation();
      const dragId = dragPhotoId;
      setDragPhotoId(null);
      if (!dragId || dragId === targetId) return;
      const next = moveId(ids, dragId, targetId);
      let changed = next.length !== ids.length;
      if (!changed) {
        for (let i = 0; i < next.length; i += 1) {
          if (next[i] !== ids[i]) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) return;
      if (onCommit) onCommit(next);
      else if (onLocalReorder) onLocalReorder(next);
    },
    [dragPhotoId, ids, onCommit, onLocalReorder],
  );

  const onDragEnd = useCallback(() => setDragPhotoId(null), []);

  return { dragPhotoId, onDragStart, onDragOverCard, onDropCard, onDragEnd };
}

/** Bir kartın sürükleme attribute'ları; dört yüzeyde birebir aynı bağ. */
export function photoCardDragProps(
  controller: PhotoReorderController,
  photoId: string | null | undefined,
  options?: { disabled?: boolean },
): {
  draggable: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  isDragging: boolean;
} {
  const id = photoId == null ? '' : String(photoId);
  return {
    draggable: Boolean(id) && !options?.disabled,
    onDragStart: (event) => controller.onDragStart(event, id),
    onDragOver: controller.onDragOverCard,
    onDrop: (event) => controller.onDropCard(event, id),
    onDragEnd: controller.onDragEnd,
    isDragging: Boolean(id) && controller.dragPhotoId === id,
  };
}
