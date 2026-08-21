// İstemci tarafı fotoğraf doğrulaması; sunucudaki photo_service kurallarının
// birebir aynısı (ALLOWED_EXTENSIONS + image/* mime + photo_max_size_mb).
export const PHOTO_ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif'] as const;
export const PHOTO_MAX_SIZE_MB = 15;
// Dosya seçici accept özniteliği için (iPhone HEIC dahil); kullanıcıya da gösterilir.
export const PHOTO_ACCEPT_ATTR = 'image/*,.heic,.heif';
export const PHOTO_MAX_SIZE_BYTES = PHOTO_MAX_SIZE_MB * 1024 * 1024;

export interface RejectedPhoto {
  file: File;
  reason: string;
}

export interface PhotoValidationResult {
  accepted: File[];
  rejected: RejectedPhoto[];
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function validatePhotoFiles(files: File[]): PhotoValidationResult {
  const accepted: File[] = [];
  const rejected: RejectedPhoto[] = [];
  for (const file of files) {
    const mime = (file.type || '').toLowerCase();
    const extension = fileExtension(file.name);
    const typeOk = mime.startsWith('image/') || (PHOTO_ALLOWED_EXTENSIONS as readonly string[]).includes(extension);
    if (!typeOk) {
      rejected.push({ file, reason: `desteklenmeyen tür (${extension || mime || 'bilinmiyor'})` });
      continue;
    }
    if (file.size > PHOTO_MAX_SIZE_BYTES) {
      rejected.push({ file, reason: `boyut limiti aşıldı (max ${PHOTO_MAX_SIZE_MB} MB)` });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

export function describeRejectedPhotos(rejected: RejectedPhoto[]): string {
  return rejected.map((item) => `${item.file.name}: ${item.reason}`).join('; ');
}

export function filesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  return Array.from(dataTransfer.files || []);
}
