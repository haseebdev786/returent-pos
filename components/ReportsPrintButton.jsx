// SAVE AS: components/ReportsPrintButton.jsx
// Print button for the reports page. A small client island: the reports
// page itself stays a server component, and only this button needs
// browser APIs. Prints the current page with window.print(); the
// filter form and this button carry the .no-print class (see
// app/globals.css) so they are left out of the printout.
"use client";

import { Icon } from "@/components/ui";

export default function ReportsPrintButton() {
  return (
    <button
      type="button"
      className="btn btn-secondary no-print"
      onClick={() => window.print()}
    >
      <Icon name="printer" className="h-4 w-4" />
      Print reports
    </button>
  );
}
