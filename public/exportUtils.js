function dataUriToBytes(dataUri) {
  const base64 = dataUri.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function createPdfBlobFromJpeg(jpegBytes, imageWidth, imageHeight) {
  const pageWidth = imageWidth > imageHeight ? 841.89 : 595.28;
  const pageHeight = imageWidth > imageHeight ? 595.28 : 841.89;
  const margin = 24;
  const scale = Math.min((pageWidth - (margin * 2)) / imageWidth, (pageHeight - (margin * 2)) / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const drawX = (pageWidth - drawWidth) / 2;
  const drawY = (pageHeight - drawHeight) / 2;
  const contentStream = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im0 Do\nQ`;
  const encoder = new TextEncoder();
  const header = '%PDF-1.4\n%ÿÿÿÿ\n';
  const objects = [
    encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'),
    encoder.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>`),
    [
      encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`),
      jpegBytes,
      encoder.encode('\nendstream'),
    ],
    encoder.encode(`<< /Length ${encoder.encode(contentStream).length} >>\nstream\n${contentStream}\nendstream`),
  ];

  const parts = [encoder.encode(header)];
  const offsets = [0];
  let length = parts[0].length;

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(length);
    parts.push(encoder.encode(`${index + 1} 0 obj\n`));
    length += parts[parts.length - 1].length;

    const object = objects[index];

    if (Array.isArray(object)) {
      for (const chunk of object) {
        parts.push(chunk);
        length += chunk.length;
      }
    } else {
      parts.push(object);
      length += object.length;
    }

    parts.push(encoder.encode('\nendobj\n'));
    length += parts[parts.length - 1].length;
  }

  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(encoder.encode(xref));
  parts.push(encoder.encode(trailer));

  return new Blob(parts, { type: 'application/pdf' });
}

function downloadWithObjectUrl(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function drawSvgToCanvas(svgMarkup, width, height, options = {}) {
  const scale = options.scale || Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
  const background = options.background || '#ffffff';
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('Failed to render the graph export.'));
      nextImage.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function downloadBlob(blob, fileName) {
  downloadWithObjectUrl(blob, fileName);
}

export async function svgToPngBlob(svgMarkup, width, height, options = {}) {
  const canvas = await drawSvgToCanvas(svgMarkup, width, height, options);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to export PNG.'));
        return;
      }

      resolve(blob);
    }, 'image/png');
  });
}

export async function svgToPdfBlob(svgMarkup, width, height, options = {}) {
  const canvas = await drawSvgToCanvas(svgMarkup, width, height, options);
  const jpegDataUri = canvas.toDataURL('image/jpeg', 0.92);
  return createPdfBlobFromJpeg(dataUriToBytes(jpegDataUri), canvas.width, canvas.height);
}
