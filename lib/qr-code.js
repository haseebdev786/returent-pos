// SAVE AS: lib/qr-code.js
// SERVER-ONLY. Never import this file from a client component — the
// `qrcode` package is a Node dependency and must stay on the server.
// Used to render table QR codes (e.g. the /t/T1 ordering link) as PNG
// data URLs for printing and display.

import QRCode from "qrcode";

export async function getTableQrDataUrl(url) {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
  });
}
