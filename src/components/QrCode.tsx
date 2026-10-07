// QR code drawn locally with the bundled `qrcode` package (CSP allows only same-origin scripts).
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCode({ text, size = 260 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#3f1210", light: "#FDF7F3" } })
      .then((url) => alive && (setSrc(url), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [text, size]);
  return (
    <div className="qr">
      {failed ? (
        <p className="muted center">The QR code could not be drawn. Share the link or the code instead.</p>
      ) : src ? (
        <img src={src} width={size} height={size} alt={"QR code for " + text} />
      ) : null}
    </div>
  );
}
