/** 写真の取り込み。撮った画像をそのまま保存すると数MBになるので、必ず縮めてから使う。
 *
 *  保存先は Firestore（alcoholPhotos）で、Firebase Storage は使わない。
 *  Storage は新しいプロジェクトだと請求先の登録を求められる場合があり、
 *  「無料のまま」を確実にするため。1文書あたり 1MiB の上限があるので、
 *  長辺 1000px・JPEG 品質 0.6 に落として 200KB 以内を狙う。
 *  検知器の表示が読めればよい用途なので、この画質で足りる。 */

const MAX_EDGE = 1000;
const QUALITY = 0.6;
/** Firestore の1文書は 1MiB まで。base64 で約1.33倍になるぶんを見て余裕を取る */
export const MAX_BYTES = 600_000;

export async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
    .catch(() => { throw new Error('この写真は読み込めませんでした。撮り直してください。'); });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let url = canvas.toDataURL('image/jpeg', QUALITY);
  // それでも大きければ、収まるまで段階的に落とす
  for (let q = QUALITY - 0.15; url.length > MAX_BYTES && q >= 0.25; q -= 0.15)
    url = canvas.toDataURL('image/jpeg', q);
  if (url.length > MAX_BYTES) throw new Error('写真が大きすぎます。撮り直してください。');
  return url;
}

/** 撮った写真を画面いっぱいに出す。閉じるまで他の操作はできない */
export function showPhoto(dataUrl: string, caption: string) {
  const d = document.createElement('dialog');
  d.className = 'photo';
  d.innerHTML = `<img alt="${caption.replace(/"/g, '&quot;')}" src="${dataUrl}">
    <p>${caption.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</p>
    <button type="button">閉じる</button>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.querySelector('button')!.addEventListener('click', () => d.close());
  d.showModal();
}
