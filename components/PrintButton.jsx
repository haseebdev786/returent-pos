// SAVE AS: components/PrintButton.jsx
"use client";

// Print button for the standalone receipt page. The button itself
// carries .no-print (see app/globals.css), so it never appears on the
// printed receipt.

import { Icon } from "@/components/ui";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn btn-secondary no-print"
    >
      <Icon name="printer" className="h-4 w-4" />
      Print receipt
    </button>
  );
}
