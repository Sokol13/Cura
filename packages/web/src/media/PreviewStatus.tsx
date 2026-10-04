import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
const en = {
  pending: 'Generating preview…',
  ready: 'Preview ready',
  failed:
    'Preview could not be generated. Rebuild thumbnails in Settings to retry.',
  SIZE_LIMIT:
    'This file exceeds the preview size limit. The original remains available.',
  PIXEL_LIMIT:
    'This image exceeds the preview pixel limit. The original remains available.',
  MODEL_LIMIT: 'This model exceeds the geometry limit for previews.',
  EXTERNAL_RESOURCE:
    'Preview requires a self-contained model with embedded local resources.',
  UNSUPPORTED_FORMAT:
    'This encoding is not supported for previews. PSD previews require RGB8 raw or RLE composites.',
  VIDEO_CODEC:
    'This browser cannot decode the video. Use an H.264 MP4 or compatible MOV for a preview.',
  WEBGL_UNAVAILABLE:
    '3D previews require WebGL. Enable browser graphics acceleration and rebuild thumbnails.',
  PDF_PASSWORD:
    'This PDF requires a password. Import an unencrypted copy for a preview.',
  INVALID_FILE:
    'This file could not be decoded. The original remains available.',
  TIMEOUT:
    'Preview generation timed out. Rebuild thumbnails in Settings to retry.',
  RENDER_FAILED:
    'Preview rendering failed. Rebuild thumbnails in Settings to retry.',
};
const zh = {
  pending: '正在生成预览…',
  ready: '预览已就绪',
  failed: '无法生成预览。请在设置中重建缩略图以重试。',
  SIZE_LIMIT: '文件超出预览大小限制，原文件仍可下载。',
  PIXEL_LIMIT: '图像超出预览像素限制，原文件仍可下载。',
  MODEL_LIMIT: '模型超出预览几何数量限制。',
  EXTERNAL_RESOURCE: '模型预览需要内嵌资源，不会加载外部文件。',
  UNSUPPORTED_FORMAT: '暂不支持此编码。PSD 预览需要 RGB8 原始或 RLE 合成图。',
  VIDEO_CODEC: '此浏览器无法解码视频。请使用 H.264 MP4 或兼容的 MOV 文件。',
  WEBGL_UNAVAILABLE:
    '3D 预览需要 WebGL。请启用浏览器图形加速，然后重建缩略图。',
  PDF_PASSWORD: 'PDF 需要密码，请导入未加密副本以生成预览。',
  INVALID_FILE: '无法解码此文件，原文件仍可下载。',
  TIMEOUT: '预览生成超时。请在设置中重建缩略图以重试。',
  RENDER_FAILED: '预览生成失败。请在设置中重建缩略图以重试。',
};
i18n.addResourceBundle('en', 'rich-preview', en, true, true);
i18n.addResourceBundle('zh-CN', 'rich-preview', zh, true, true);
export function PreviewStatus({
  state,
  error,
}: {
  state?: string | undefined;
  error?: string | null | undefined;
}) {
  const { t } = useTranslation('rich-preview');
  return (
    <p className="field-hint" role="status">
      {t(
        error && error in en
          ? error
          : state === 'ready'
            ? 'ready'
            : state === 'unsupported' || state === 'failed'
              ? 'failed'
              : 'pending',
      )}
    </p>
  );
}
