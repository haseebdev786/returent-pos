// SAVE AS: components/QrPrintButton.jsx
"use client";

// Print button for the table QR page. A separate component from the
// receipt phase's PrintButton (fixed "Print receipt" label) so neither
// phase edits the other's file. The QR page hides its whole header
// block in print via .no-print; this button only triggers window.print.

import { Icon } from "@/components/ui";

export default function QrPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn btn-primary"
    >
      <Icon name="printer" className="h-4 w-4" />
      Print
    </button>
  );
}
